import type { Asset } from '../lib/asset'
import type { LiveUpdate } from '../lib/live'
import { confirmedLocation } from '../lib/segments'
import type { SharedView } from '../lib/share'
import { trailProfile, type TrackerKind } from '../lib/tracker'
import { HISTORY_MIN_MINUTES, type TrailPoint } from '../lib/trail'
import { lookUpAddress } from './address.server'
import { toAsset, toDeviceUpdate, toPositionUpdate, toTrailPoint } from './assets.server'
import { env } from './env.server'
import { imageResponse } from './images.server'
import { adapterFor } from './trackers.server'
import { connectUpstream, relay } from './live.server'
import { sealLiveLink, unsealLiveLink, type LiveLinkData } from './liveLinkSeal.server'
import {
  createToken,
  getDevice,
  getLatestPositions,
  getPositionHistory,
  revokeToken,
  TraccarError,
  type TraccarDevice,
  type TraccarPosition,
} from './traccar.server'

// Live location links: /s/<link> shows one asset, following it live, to anyone with the link and
// without signing in, until the link expires or is stopped. The link is sealed (liveLinkSeal.server.ts)
// and holds a Traccar token of the sharer's own, made for this link and expiring with it, so Traccar
// enforces the expiry too. Stopping a link revokes that token. What a viewer gets is deliberately
// less than the app shows: the asset's name, picture, position, status and address; never its
// battery, trail, tracker ID, or anything about the sharer or their other assets. The position is
// where the app shows it too: the last fix GPS confirmed (see confirmedLocation in segments.ts),
// judged here on the asset's recent fixes, which stay on the server.

/** Creates a link to `assetId` lasting `hours`, capped at the sharer's own session. */
export async function createLiveLink(
  sessionToken: string,
  sessionExpiresAt: number,
  assetId: number,
  hours: number,
): Promise<{ link: string; expiresAt: number }> {
  // Also Traccar's permission check: only assets this user may see can be shared.
  if (!(await getDevice(sessionToken, assetId))) throw new Error('No such asset')
  const expiresAt = Math.min(Date.now() + hours * 60 * 60 * 1000, sessionExpiresAt)
  const token = await createToken(sessionToken, new Date(expiresAt))
  return { link: sealLiveLink({ assetId, token, expiresAt }, env().sessionSecret), expiresAt }
}

/** Stops a link at once: its token is revoked, and open pages end within a minute (see relay). */
export async function stopLiveLink(link: string): Promise<void> {
  const data = unsealLiveLink(link, env().sessionSecret)
  if (!data || data.expiresAt <= Date.now()) return
  try {
    // With the link's own token, so it only ever revokes itself.
    await revokeToken(data.token)
  } catch (error) {
    // Already revoked or no longer accepted: stopped either way.
    if (!(error instanceof TraccarError && error.status === 401)) throw error
  }
}

export async function loadSharedView(link: string): Promise<SharedView> {
  const opened = openLink(link)
  if (opened.kind !== 'ok') return { kind: opened.kind }
  const { data } = opened
  try {
    const shared = await loadShared(data, link)
    if (!shared) return { kind: 'stopped' }
    const { lat, lon } = shared.location ?? {}
    const address = lat !== undefined && lon !== undefined ? await lookUpAddress(data.token, lat, lon) : null
    return { kind: 'live', asset: shared, address, expiresAt: data.expiresAt }
  } catch (error) {
    if (error instanceof TraccarError && error.status === 401) return { kind: 'stopped' }
    console.warn('Could not load a shared asset:', error instanceof Error ? error.message : error)
    return { kind: 'unavailable' }
  }
}

/** The shared asset's address where it is now, or null. */
export async function sharedAddress(link: string): Promise<string | null> {
  const opened = openLink(link)
  if (opened.kind !== 'ok') return null
  const shared = await loadShared(opened.data, link).catch(() => null)
  if (!shared?.location) return null
  return lookUpAddress(opened.data.token, shared.location.lat, shared.location.lon)
}

export async function sharedImageResponse(request: Request, link: string): Promise<Response> {
  const opened = openLink(link)
  if (opened.kind !== 'ok') return new Response('Not found', { status: 404 })
  const response = await imageResponse(request, opened.data.token, opened.data.assetId)
  return response.status === 401 ? new Response('Not found', { status: 404 }) : response
}

/** GET /s/<link>/live: the shared asset's updates, until the link expires or is stopped. */
export async function sharedLiveResponse(request: Request, link: string): Promise<Response> {
  const opened = openLink(link)
  // 204 tells EventSource to stop reconnecting; the page then shows why.
  if (opened.kind !== 'ok') return new Response(null, { status: 204 })
  const { data } = opened

  // Whether the link still works: Traccar still accepts its token, and the sharer still sees the asset.
  const stillShared = async () => {
    try {
      return (await getDevice(data.token, data.assetId)) !== null
    } catch (error) {
      return !(error instanceof TraccarError && error.status === 401)
    }
  }

  const socket = await connectUpstream(data.token)
  if (!socket) {
    // The socket gives no reason; a stopped link ends quietly, anything else is worth retrying.
    return (await stillShared()) ? new Response('Live updates are unavailable', { status: 502 }) : new Response(null, { status: 204 })
  }
  const fixes = await recentFixes(data, await latestPosition(data))
  return relay(request, socket, ({ devices, positions }) => toSharedUpdates(devices, positions, data.assetId, link, fixes), {
    endAt: data.expiresAt,
    check: stillShared,
  })
}

type Opened = { kind: 'ok'; data: LiveLinkData } | { kind: 'invalid' } | { kind: 'expired' }

function openLink(link: string): Opened {
  const data = unsealLiveLink(link, env().sessionSecret)
  if (!data) return { kind: 'invalid' }
  if (data.expiresAt <= Date.now()) return { kind: 'expired' }
  return { kind: 'ok', data }
}

/** The asset as a viewer sees it, or null when the sharer can no longer see it either. */
async function loadShared(data: LiveLinkData, link: string): Promise<Asset | null> {
  const [device, latest] = await Promise.all([getDevice(data.token, data.assetId), latestPosition(data)])
  if (!device || device.disabled) return null
  const asset = toAsset(device, latest)
  const fixes = await recentFixes(data, latest)
  const location = asset.location && confirmedLocation(asset.location, fixes.points, trailProfile(fixes.tracker))
  return { ...asset, location, battery: undefined, tracker: undefined, imageUrl: sharedImageUrl(device, link), placeIds: [] }
}

async function latestPosition(data: LiveLinkData): Promise<TraccarPosition | undefined> {
  return (await getLatestPositions(data.token)).find((position) => position.deviceId === data.assetId)
}

/** The asset's recent fixes, to judge where to show it, and its kind of tracker; kept up to date while a page follows it. */
type RecentFixes = { points: TrailPoint[]; tracker?: TrackerKind }

/**
 * The HISTORY_MIN_MINUTES before the asset's latest fix (a tracker asleep reports nothing for hours),
 * as the app loads them. None when Traccar won't give them (reports disabled): then the latest as it is.
 */
async function recentFixes(data: LiveLinkData, latest: TraccarPosition | undefined): Promise<RecentFixes> {
  const fixes: RecentFixes = { points: [], tracker: latest ? adapterFor(latest.protocol).kind : undefined }
  if (!latest) return fixes
  const to = new Date()
  const from = new Date(Math.min(to.getTime(), Date.parse(latest.fixTime)) - HISTORY_MIN_MINUTES * 60 * 1000)
  try {
    fixes.points = (await getPositionHistory(data.token, data.assetId, from, to)).map(toTrailPoint).sort((a, b) => a.time - b.time)
  } catch (error) {
    if (error instanceof TraccarError && error.status === 401) throw error
  }
  return fixes
}

/** Only this asset's updates, with the same fields left out as on the page, at the position the app shows. */
function toSharedUpdates(
  devices: TraccarDevice[],
  positions: TraccarPosition[],
  assetId: number,
  link: string,
  fixes: RecentFixes,
): LiveUpdate[] {
  const updates: LiveUpdate[] = []
  for (const device of devices) {
    if (device.id !== assetId) continue
    const update = toDeviceUpdate(device)
    if (update.kind === 'device') updates.push({ ...update, imageUrl: sharedImageUrl(device, link) })
  }
  for (const position of positions) {
    if (position.deviceId !== assetId) continue
    const update = toPositionUpdate(position)
    if (update.kind !== 'position') continue
    const point = toTrailPoint(position)
    if (point.time > (fixes.points.at(-1)?.time ?? 0)) fixes.points.push(point)
    fixes.tracker = update.tracker ?? fixes.tracker
    // Only as far back as the app looks: a page left open for days keeps a few hours of fixes.
    const since = point.time - 2 * HISTORY_MIN_MINUTES * 60 * 1000
    if ((fixes.points[0]?.time ?? since) < since) fixes.points = fixes.points.filter((fix) => fix.time >= since)
    const location = confirmedLocation(update.location, fixes.points, trailProfile(fixes.tracker))
    updates.push({ kind: 'position', id: update.id, location, valid: update.valid, placeIds: [] })
  }
  return updates
}

function sharedImageUrl(device: TraccarDevice, link: string): string | undefined {
  return device.image ? `/s/${link}/image?v=${device.image}` : undefined
}
