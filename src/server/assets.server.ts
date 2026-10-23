import type { Asset } from '../lib/asset'
import type { LiveUpdate } from '../lib/live'
import { historyStart, type Trails } from '../lib/trail'
import { assetImageVersion } from './images.server'
import { toLocation, toTrailPoint } from './positions.server'
import { adapterFor, readPosition } from './trackers.server'
import {
  getDevices,
  getLatestPositions,
  getPositionHistory,
  TraccarError,
  type TraccarDevice,
  type TraccarPosition,
} from './traccar.server'

export async function loadAssets(token: string): Promise<Asset[]> {
  const [devices, positions] = await Promise.all([getDevices(token), getLatestPositions(token)])
  const positionByDevice = new Map(positions.map((position) => [position.deviceId, position]))
  return devices
    .filter((device) => !device.disabled)
    .map((device) => toAsset(device, positionByDevice.get(device.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Reports from `minutes` before each asset's latest (see historyStart), including those without a GPS
 * fix: they're evidence of travel without GPS (see segments.ts). An asset whose history fails just
 * gets no trail.
 */
export async function loadTrails(token: string, assetIds: number[], minutes: number): Promise<Trails> {
  const to = new Date()
  const latest = await latestReports(token)
  const results = await Promise.allSettled(
    assetIds.map((id) => getPositionHistory(token, id, new Date(historyStart(minutes, to.getTime(), latest.get(id))), to)),
  )
  const trails: Trails = {}
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      // A rejected token should sign the user out like any other call; other failures only cost the trail.
      if (result.reason instanceof TraccarError && result.reason.status === 401) throw result.reason
      console.warn(`No trail for asset ${assetIds[index]}:`, String(result.reason))
      return
    }
    trails[assetIds[index]!] = result.value.map(toTrailPoint).sort((a, b) => a.time - b.time)
  })
  return trails
}

/**
 * An asset's reports between two times (see getHistory): more of its history, before what was loaded
 * or since a silence. One whose history fails gets none.
 */
export async function loadHistory(token: string, assetId: number, from: number, to: number): Promise<Trails[number]> {
  try {
    return (await getPositionHistory(token, assetId, new Date(from), new Date(to))).map(toTrailPoint).sort((a, b) => a.time - b.time)
  } catch (error) {
    if (error instanceof TraccarError && error.status === 401) throw error
    console.warn(`No history for asset ${assetId}:`, String(error))
    return []
  }
}

/** Each device's latest report's time; none if Traccar can't say, so its history ends now. */
async function latestReports(token: string): Promise<Map<number, number>> {
  try {
    return new Map((await getLatestPositions(token)).map((position) => [position.deviceId, Date.parse(position.fixTime)]))
  } catch (error) {
    if (error instanceof TraccarError && error.status === 401) throw error
    return new Map()
  }
}

export function toAsset(device: TraccarDevice, position: TraccarPosition | undefined): Asset {
  const asset: Asset = {
    id: device.id,
    name: device.name,
    status: device.status,
    lastUpdate: device.lastUpdate,
    location: position ? toLocation(position) : null,
    battery: position ? readPosition(position).battery : undefined,
    imageUrl: imageUrl(device),
    placeIds: position?.geofenceIds ?? [],
  }
  if (position) asset.tracker = adapterFor(position.protocol).kind
  return asset
}

export function toDeviceUpdate(device: TraccarDevice): LiveUpdate {
  return {
    kind: 'device',
    id: device.id,
    name: device.name,
    status: device.status,
    lastUpdate: device.lastUpdate,
    disabled: device.disabled,
    imageUrl: imageUrl(device),
  }
}

/** The filename and panopticon's own upload version go in the query, so a new image gets a fresh URL. */
export function imageUrl(device: TraccarDevice): string | undefined {
  if (!device.image) return undefined
  const version = assetImageVersion(device.id)
  return `/images/asset/${device.id}?v=${device.image}${version ? `-${version}` : ''}`
}
