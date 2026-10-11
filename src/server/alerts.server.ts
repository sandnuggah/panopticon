import { createHash, timingSafeEqual } from 'node:crypto'
import { alertBody, alertTitle, crossPlace, ruleForEvent, settlePlace, SETTLE_MS, type AlertRule, type PlaceAlerts } from '../lib/alerts'
import { sealAlerts, unsealAlerts, type AlertEntry } from './alertsSeal.server'
import { env } from './env.server'
import { attempt, loadManagedAssets, type EditResult } from './manage.server'
import { loadPlaces } from './places.server'
import { deviceAttributes, getDevices, updateDevice } from './traccar.server'
import { sendPush, vapidKeys, type PushTarget } from './webPush.server'

// Alerts: Traccar forwards every event to panopticon (`event.forward.url`, see README), with the
// device and its attributes. Each device carries, sealed, the phones that want alerts for it and
// which (alertsSeal.server.ts), so panopticon sends them without storing anything or holding a
// Traccar login. A phone chooses its alerts in Settings → Alerts, which writes them onto the
// devices with the user's own token: changing them needs the same Traccar rights as changing assets.

const ATTRIBUTE = 'panopticonAlerts'
/** Traccar keeps a device's attributes in a column of limited size; leave room for the rest. */
const MAX_ATTRIBUTE_LENGTH = 3500
/** Events Traccar only learns of late (a tracker sending buffered positions) aren't news any more. */
const MAX_EVENT_AGE_MS = 15 * 60_000
const MAX_EVENT_BYTES = 256 * 1024
/** A tracker that keeps dropping its connection would otherwise alert every few minutes. */
const OFFLINE_QUIET_MS = 30 * 60_000

/** Subscriptions push services said are gone; dropped from a device the next time its alerts are saved. */
const goneEndpoints = new Set<string>()
/** When each phone last heard that each asset went offline, by `deviceId endpoint`. */
const lastOffline = new Map<string, number>()
/** Each asset's alerts about each place while its crossings settle (lib/alerts.ts), by `deviceId placeId`. */
const settling = new Map<string, { state: PlaceAlerts; latest?: AlertNews; timer?: ReturnType<typeof setTimeout> }>()

/** One thing to alert about: what happened, to which device (with its attributes), where and when. */
type AlertNews = { rule: AlertRule; device: { id: number; name: string; attributes: unknown }; placeName: string | null; time: string }

export type AlertSetup = {
  /** Whether the server can send alerts (TRACCAR_EVENTS_SECRET is set, so Traccar forwards events). */
  available: boolean
  /** The server's VAPID public key, for the browser's push subscription. */
  vapidPublicKey: string
  /** Whether the user may change alerts: they're kept on the devices. */
  canEdit: boolean
  /** The assets, their places, and the alerts this phone (`endpoint`) has for each. */
  assets: { id: number; name: string; places: { id: number; name: string }[]; rules: AlertRule[] }[]
}

export async function loadAlertSetup(token: string, endpoint: string | null): Promise<AlertSetup> {
  const { eventsSecret, sessionSecret } = env()
  const [{ access }, devices, places] = await Promise.all([loadManagedAssets(token), getDevices(token), loadPlaces(token)])
  return {
    available: eventsSecret !== undefined,
    vapidPublicKey: vapidKeys(sessionSecret).publicKey.toString('base64url'),
    canEdit: access.canEdit,
    assets: devices
      .filter((device) => !device.disabled)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((device) => ({
        id: device.id,
        name: device.name,
        places: places.filter((place) => place.assetIds.includes(device.id)).map(({ id, name }) => ({ id, name })),
        rules: endpoint
          ? (unsealAlerts(device.alerts, device.id, sessionSecret).find((entry) => entry.endpoint === endpoint)?.rules ?? [])
          : [],
      })),
  }
}

/** One phone's alerts: its subscription, where and how it reads them, and the rules per asset (none: off). */
export type PhoneAlerts = {
  target: PushTarget
  origin: string
  timeZone: string
  locale: string
  rules: Record<number, AlertRule[]>
}

/** Writes this phone's alerts onto each device whose alerts change, and drops it from the rest. */
export function savePhoneAlerts(token: string, phone: PhoneAlerts): Promise<EditResult> {
  const secret = env().sessionSecret
  return attempt(token, async (): Promise<EditResult> => {
    for (const device of await getDevices(token)) {
      const current = unsealAlerts(device.alerts, device.id, secret)
      const rules = phone.rules[device.id] ?? []
      const next: AlertEntry[] = current.filter((entry) => entry.endpoint !== phone.target.endpoint && !goneEndpoints.has(entry.endpoint))
      if (rules.length > 0) next.push({ ...phone.target, origin: phone.origin, timeZone: phone.timeZone, locale: phone.locale, rules })
      if (JSON.stringify(next) === JSON.stringify(current)) continue
      const sealed = next.length > 0 ? sealAlerts(next, device.id, secret) : null
      if (sealed && sealed.length > MAX_ATTRIBUTE_LENGTH) return { ok: false, error: 'alerts-full' }
      await updateDevice(token, device.id, (full) => {
        const attributes = deviceAttributes(full)
        if (sealed) attributes[ATTRIBUTE] = sealed
        else delete attributes[ATTRIBUTE]
      })
    }
    return { ok: true }
  })
}

/** "Alerts are on", straight to the phone: checks the phone's side without waiting for an event. */
export function sendTestAlert(target: PushTarget, origin: string) {
  return sendPush(
    target,
    pushMessage('Alerts are on', "This is how Panopticon's alerts look on this device.", `${origin}/`, 'test'),
    origin,
    env().sessionSecret,
  )
}

/**
 * POST /hooks/traccar-events: an event Traccar forwards. Answers 204 whatever happens to the
 * alerts, so Traccar doesn't retry; 401 without the right secret, 404 when alerts aren't set up.
 */
export async function handleTraccarEvent(request: Request): Promise<Response> {
  const { eventsSecret } = env()
  if (!eventsSecret) return new Response(null, { status: 404 })
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${eventsSecret}`)) return new Response(null, { status: 401 })

  // An event with its position, device and geofence is a few kilobytes.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_EVENT_BYTES) return new Response(null, { status: 413 })
  let data: Record<string, unknown>
  try {
    const body = await request.text()
    if (body.length > MAX_EVENT_BYTES) return new Response(null, { status: 413 })
    data = JSON.parse(body) as Record<string, unknown>
  } catch {
    return new Response(null, { status: 400 })
  }
  const event = object(data.event)
  const device = object(data.device)
  if (!event || !device || typeof event.type !== 'string' || typeof event.eventTime !== 'string') return new Response(null, { status: 400 })
  if (typeof device.id !== 'number' || device.id !== event.deviceId || typeof device.name !== 'string')
    return new Response(null, { status: 400 })

  const rule = ruleForEvent({ type: event.type, geofenceId: typeof event.geofenceId === 'number' ? event.geofenceId : 0 })
  const age = Date.now() - Date.parse(event.eventTime)
  if (!rule || !(age < MAX_EVENT_AGE_MS)) return new Response(null, { status: 204 })

  const placeName = typeof object(data.geofence)?.name === 'string' ? (object(data.geofence)!.name as string) : null
  const news: AlertNews = {
    rule,
    device: { id: device.id, name: device.name, attributes: device.attributes },
    placeName,
    time: event.eventTime,
  }
  if (rule === 'offline') await sendAlerts(news)
  else await crossing(news)
  return new Response(null, { status: 204 })
}

/** A crossing of a place: alerted now, or kept until the place settles (`crossPlace`). */
async function crossing(news: AlertNews) {
  const key = `${news.device.id} ${news.rule.split(':')[1]}`
  const place = settling.get(key)
  const { send, state } = crossPlace(place?.state, news.rule, Date.now())
  if (send) {
    if (place?.timer) clearTimeout(place.timer)
    settling.set(key, { state })
    return sendAlerts(news)
  }
  const timer = place?.timer ?? setTimeout(() => void settle(key), state.sentAt + SETTLE_MS - Date.now())
  settling.set(key, { state, latest: news, timer })
}

/** The end of a place's settling time: the latest crossing, if the asset ended up on the other side. */
async function settle(key: string) {
  const place = settling.get(key)
  if (!place) return
  const { send, state } = settlePlace(place.state, Date.now())
  if (state) settling.set(key, { state })
  else settling.delete(key)
  if (send && place.latest) await sendAlerts(place.latest)
}

/** Sends an alert to each phone that wants it, from the phones sealed on the device. */
async function sendAlerts({ rule, device, placeName, time }: AlertNews) {
  const sessionSecret = env().sessionSecret
  const entries = unsealAlerts(object(device.attributes)?.[ATTRIBUTE], device.id, sessionSecret).filter((entry) =>
    entry.rules.includes(rule),
  )
  await Promise.all(
    entries.map(async (entry) => {
      if (rule === 'offline') {
        const key = `${device.id} ${entry.endpoint}`
        if (Date.now() - (lastOffline.get(key) ?? 0) < OFFLINE_QUIET_MS) return
        lastOffline.set(key, Date.now())
      }
      const message = pushMessage(
        alertTitle(rule, device.name, placeName),
        alertBody(time, entry.timeZone, entry.locale),
        `${entry.origin}/?asset=${device.id}&details=true`,
        `asset-${device.id}`,
      )
      const result = await sendPush(entry, message, entry.origin, sessionSecret)
      if (result === 'gone') goneEndpoints.add(entry.endpoint)
    }),
  )
}

/**
 * The push message: Declarative Web Push's format, which Safari shows by itself (iOS 18.4 and
 * later), and which the service worker (public/sw.js) shows on other browsers. `tag`: a newer
 * alert about the same asset replaces the last one.
 */
function pushMessage(title: string, body: string, url: string, tag: string) {
  return { web_push: 8030, notification: { title, body, navigate: url, tag } }
}

/** Compares secrets in constant time, whatever their lengths. */
function sameSecret(given: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(given), hash(expected))
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
