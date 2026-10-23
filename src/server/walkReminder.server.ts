import { pushMessage } from '../lib/alerts'
import type { Place } from '../lib/places'
import type { TrailPoint } from '../lib/trail'
import { trailProfile } from '../lib/tracker'
import { parseWalkRule, walkReminderDue, walkReminderText, walkRuleOf, walkState } from '../lib/walkReminder'
import { unsealAlerts, type AlertEntry } from './alertsSeal.server'
import { env } from './env.server'
import { loadPlaces } from './places.server'
import { toTrailPoint } from './positions.server'
import { adapterFor } from './trackers.server'
import { getPositionHistory, TraccarError } from './traccar.server'
import { sendPush } from './webPush.server'

// Walk reminders ("puppy mode", lib/walkReminder.ts): every few minutes, for each asset a phone
// wants reminders for, its recent history is read with the Traccar token sealed with the phone's
// alerts (alertsSeal.server.ts), and a reminder is sent when it's due. Kept in memory like the
// other alerts: after a restart, an asset is known again when its alerts are saved, the app is
// opened on a phone with a reminder, or Traccar forwards an event for it (see trackWalkReminders).

/** How often each asset is checked. */
const CHECK_MS = 5 * 60_000
/** How much history a check looks at: a day, and enough before it for a stay to be one. */
const HISTORY_MS = 26 * 3_600_000
/** Places change rarely, and loading them asks Traccar once per device. */
const PLACES_MS = 30 * 60_000

type Tracked = {
  name: string
  entries: AlertEntry[]
  points: TrailPoint[]
  /** Up to when the history has been read. */
  readTo: number
  protocol?: string
  places?: { list: Place[]; at: number }
}

const tracked = new Map<number, Tracked>()
/** The wait last reminded of (when it began), by `deviceId endpoint`. */
const reminded = new Map<string, number>()
let timer: ReturnType<typeof setInterval> | undefined

/**
 * Notes an asset's walk reminders from its sealed alerts (a device's `panopticonAlerts`): the phones
 * with one and a token; none stops them.
 */
export function trackWalkReminders(device: { id: number; name: string; alerts: unknown }) {
  const entries = unsealAlerts(device.alerts, device.id, env().sessionSecret).filter(
    (entry) => walkRuleOf(entry.rules) && entry.token && (entry.tokenExpires ?? 0) > Date.now(),
  )
  if (entries.length === 0) {
    tracked.delete(device.id)
    return
  }
  const current = tracked.get(device.id)
  tracked.set(device.id, current ? { ...current, name: device.name, entries } : { name: device.name, entries, points: [], readTo: 0 })
  timer ??= setInterval(() => void checkWalkReminders(), CHECK_MS)
  if (!current) void checkAsset(device.id)
}

/** Checks every asset with a walk reminder. */
export async function checkWalkReminders(now = Date.now()) {
  await Promise.all([...tracked.keys()].map((id) => checkAsset(id, now)))
}

async function checkAsset(id: number, now = Date.now()) {
  const asset = tracked.get(id)
  if (!asset) return
  try {
    await read(id, asset, now)
  } catch (error) {
    // A token Traccar no longer takes: that phone's reminder stops until the app renews it.
    if (error instanceof TraccarError && error.status === 401) {
      asset.entries = asset.entries.slice(1)
      if (asset.entries.length === 0) tracked.delete(id)
    } else console.warn(`Walk reminder for asset ${id}:`, error instanceof Error ? error.message : error)
    return
  }
  const profile = trailProfile(adapterFor(asset.protocol).kind)
  const state = walkState(asset.points, asset.places?.list ?? [], id, profile, now)
  // With no walk in the history read, the wait goes back to its start.
  const since = state.last?.end ?? asset.points[0]?.time ?? now
  const sessionSecret = env().sessionSecret
  await Promise.all(
    asset.entries.map(async (entry) => {
      const rule = parseWalkRule(walkRuleOf(entry.rules)!)
      const key = `${id} ${entry.endpoint}`
      if (!rule || !walkReminderDue({ ...state, since, now, rule, timeZone: entry.timeZone, reminded: reminded.get(key) })) return
      reminded.set(key, since)
      const { title, body } = walkReminderText(asset.name, state.last, since, now, rule, entry.timeZone, entry.locale)
      const message = pushMessage(title, body, `${entry.origin}/?asset=${id}&details=true`, `asset-${id}`)
      const result = await sendPush(entry, message, entry.origin, sessionSecret)
      console.info(`Walk reminder for ${asset.name}: "${title}" (${result})`)
    }),
  )
}

/** Reads what's new of the asset's history (with the first token that works), and its places now and then. */
async function read(id: number, asset: Tracked, now: number) {
  const token = asset.entries[0]!.token!
  const from = Math.max(asset.readTo, now - HISTORY_MS)
  const positions = await getPositionHistory(token, id, new Date(from), new Date(now))
  asset.protocol = positions.findLast((position) => position.protocol)?.protocol ?? asset.protocol
  const fresh = positions.map(toTrailPoint).filter((point) => point.time > (asset.points.at(-1)?.time ?? 0))
  asset.points = [...asset.points, ...fresh].sort((a, b) => a.time - b.time).filter((point) => point.time >= now - HISTORY_MS)
  asset.readTo = now
  if (!asset.places || now - asset.places.at > PLACES_MS) asset.places = { list: await loadPlaces(token), at: now }
}
