import type { LiveUpdate } from './live'

export type TrailPoint = {
  lat: number
  lon: number
  /** Fix time in ms since epoch. */
  time: number
  /**
   * False for reports without a GPS fix. Their position is stale, so they're never drawn; they
   * only serve as evidence of travel without GPS (see segments.ts).
   */
  valid: boolean
  /** The cell tower serving the tracker, when it reports one. */
  cell?: number
  /** How good the fix is, when the tracker says: satellites used, or how far off it may be (metres). See isWeak in segments.ts. */
  satellites?: number
  accuracy?: number
}

/** Oldest point first, per asset id. */
export type Trails = Record<number, TrailPoint[]>

/**
 * How much trail to draw: minutes back from now (0 turns trails off), everything since midnight, or
 * each asset's latest outing (see latestOutingStart in segments.ts and shownTrails in trailGeometry.ts).
 */
export type TrailLength = number | 'today' | 'outing'

/**
 * The lengths offered in settings. This outing, the default, is the walk under way or the last one:
 * with an hour, Kofi's map showed no trail in 76% of quarter-hours, nearly all of them asleep at home.
 */
export const TRAIL_OPTIONS: readonly TrailLength[] = [0, 'outing', 'today', 1440]
export const DEFAULT_TRAIL: TrailLength = 'outing'
export const MAX_TRAIL_MINUTES = 1440

/**
 * How an asset's trail is drawn, chosen on its page under Assets and stored on the device in Traccar
 * (see traccar.server.ts), so it's the same everywhere: how much of it, whether its walks are paw
 * prints close up, and whether they're snapped to streets and paths (when the server can).
 */
export type TrailOptions = { length: TrailLength; pawPrints: boolean; snapToPaths: boolean }

export const DEFAULT_TRAIL_OPTIONS: TrailOptions = { length: DEFAULT_TRAIL, pawPrints: false, snapToPaths: true }

/** An asset's trail options: what was chosen for it, the defaults for the rest. */
export function trailOptionsOf(asset: { trail?: Partial<TrailOptions> } | undefined): TrailOptions {
  return { ...DEFAULT_TRAIL_OPTIONS, ...asset?.trail }
}

/** "This outing", "Today", "24 hours", "Off": the trail length as the app shows it. */
export function trailLabel(length: TrailLength): string {
  if (length === 'outing') return 'This outing'
  if (length === 'today') return 'Today'
  if (length === 0) return 'Off'
  if (length < 60) return `${length} minutes`
  const hours = length / 60
  return hours === 1 ? '1 hour' : `${hours} hours`
}

/**
 * Where the trail starts (ms since epoch), or null when trails are off. "Today" is local midnight;
 * "outing" starts with each asset's latest outing (see shownTrails in trailGeometry.ts).
 */
export function trailStart(length: TrailLength, now: number): number | 'outing' | null {
  if (length === 'outing') return 'outing'
  if (length === 'today') return new Date(now).setHours(0, 0, 0, 0)
  return length === 0 ? null : now - length * 60 * 1000
}

/** How many minutes back a trail goes: a day at most, which also covers "today" and an outing. */
export function trailMinutes(length: TrailLength): number {
  return length === 'today' || length === 'outing' ? MAX_TRAIL_MINUTES : length
}

/**
 * The option for a saved value, since the options change over time: an hour or less (as the default
 * was until October 2026) is this outing, longer is 24 hours. Undefined when it isn't a trail length.
 */
export function nearestTrail(value: unknown): TrailLength | undefined {
  if (value === 'today' || value === 'outing' || value === 0) return value
  if (typeof value !== 'number' || !(value > 0)) return undefined
  return value <= 60 ? 'outing' : MAX_TRAIL_MINUTES
}
/**
 * History always covers at least this much, to tell what an asset is doing right now and how long
 * it's been in one place. A day at the park still fits; longer stays show "since before".
 */
export const HISTORY_MIN_MINUTES = 180

/**
 * How many minutes of history to load, whatever the trail's length (it needs at most a day): a day
 * and HISTORY_MIN_MINUTES before it. Enough for the trail to be worked out at its start as it would
 * be anywhere else (see trailView in trailGeometry.ts): a walk under way when it starts, a stay long
 * enough to be one, a fix it can check against the one before; and for where an asset is (see
 * presence.ts) to go back past a night's sleep: an ST-904L at home sends nothing for hours, and a
 * shorter history was cut to after the sleep when it woke, as if it hadn't been home at all.
 */
export const MAX_HISTORY_MINUTES = MAX_TRAIL_MINUTES + HISTORY_MIN_MINUTES
export function historyMinutes(_length?: TrailLength): number {
  return MAX_HISTORY_MINUTES
}

/**
 * The points "Here since" goes by (see currentStay): HISTORY_MIN_MINUTES, or the trail's length if
 * longer, back from the newest, as the history was before it covered more; not all of the history,
 * since currentStay joins one stay at a place with the next across walks, and over more of it, more.
 */
export function stayPoints(points: TrailPoint[], length: TrailLength): TrailPoint[] {
  const newest = points.at(-1)
  if (!newest) return points
  const from = newest.time - Math.max(trailMinutes(length), HISTORY_MIN_MINUTES) * 60 * 1000
  return points[0]!.time >= from ? points : points.filter((point) => point.time >= from)
}

/**
 * Where an asset's history starts (ms since epoch): `minutes` before its latest report (as of `now`),
 * as a page open all along keeps it (see extendTrails), so a page loaded now shows the same trail; for
 * a tracker asleep (see QUIET_MS in segments.ts), that takes in the stay it went quiet in ("Here
 * since"). For one quiet over a day, or never heard from, `minutes` before now.
 */
export function historyStart(minutes: number, now: number, lastReport: number | undefined): number {
  const latest = lastReport === undefined || lastReport < now - MAX_TRAIL_MINUTES * 60 * 1000 ? now : Math.min(lastReport, now)
  return latest - minutes * 60 * 1000
}

/**
 * History goes back further than `minutes` for the visit an asset is at (see keepFrom in presence.ts),
 * so a long stay isn't cut as it goes on, but no further than this before now.
 */
export const MAX_EXTRA_HISTORY_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Adds live positions (with or without a GPS fix) to the trails, keeping `minutes` of history before
 * each asset's newest (as of `now`), as it's loaded (see historyStart), and everything from `keep`
 * (by asset: the visit it's at, see keepFrom in presence.ts).
 */
export function extendTrails(
  trails: Trails,
  updates: LiveUpdate[],
  minutes: number,
  now: number,
  keep: Record<number, number> = {},
): Trails {
  let next = trails
  for (const update of updates) {
    if (update.kind !== 'position') continue
    const time = Date.parse(update.location.fixTime)
    const since = Math.max(now - MAX_EXTRA_HISTORY_MS, Math.min(Math.min(time, now) - minutes * 60 * 1000, keep[update.id] ?? Infinity))
    const trail = next[update.id] ?? []
    const last = trail.at(-1)
    if (last && time <= last.time) continue
    const point: TrailPoint = { lat: update.location.lat, lon: update.location.lon, time, valid: update.valid }
    if (update.cell !== undefined) point.cell = update.cell
    if (update.satellites !== undefined) point.satellites = update.satellites
    if (update.location.accuracy !== undefined) point.accuracy = update.location.accuracy
    next = { ...next, [update.id]: [...trail.filter((p) => p.time >= since), point] }
  }
  return next
}

/**
 * A report more than this long after the one before ends a silence (longer than a phone's usual interval): Traccar's live stream doesn't pass on
 * reports older than the latest it sent (a tracker uploading what it kept while out of reach), so
 * the reports since the one before are fetched, this long after, once it has uploaded them (see
 * useLiveAssets). On a week of Kofi's, 3 fixes came 24–92 minutes late.
 */
export const MISSED_SILENCE_MS = 10 * 60 * 1000
export const MISSED_AFTER_MS = 60 * 1000

/**
 * An asset's points with more of its history fetched later (earlier days, or reports the live stream
 * missed: it doesn't pass on reports older than the latest it sent), together by time, each once.
 */
export function mergeHistory(points: TrailPoint[], more: TrailPoint[]): TrailPoint[] {
  if (more.length === 0) return points
  const times = new Set(points.map((point) => point.time))
  const added = more.filter((point) => !times.has(point.time))
  return added.length === 0 ? points : [...points, ...added].sort((a, b) => a.time - b.time)
}

/**
 * A history loaded again (`history`), with the points the page had (`current`) from `keep` (by asset:
 * the visit it's at, see keepFrom in presence.ts) to where the history starts: a long stay isn't cut
 * back to the history's length when the page comes back to the tab or reconnects.
 */
export function keepEarlier(history: Trails, current: Trails, keep: Record<number, number>): Trails {
  let result = history
  for (const [key, points] of Object.entries(history)) {
    const id = Number(key)
    const from = keep[id]
    const start = points[0]?.time ?? Infinity
    // Not after the page was away for longer than the history: what came between is gone.
    if (from === undefined || from >= start || (current[id]?.at(-1)?.time ?? -Infinity) < start) continue
    const kept = (current[id] ?? []).filter((point) => point.time >= from && point.time < start)
    if (kept.length > 0) result = { ...result, [id]: mergeHistory(points, kept) }
  }
  return result
}
