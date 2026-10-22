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

/** How much trail to draw: minutes back from now (0 turns trails off), or everything since midnight. */
export type TrailLength = number | 'today'

/** The lengths offered in settings: the last walk, parts of the day, the whole day, and "today". */
export const TRAIL_OPTIONS: readonly TrailLength[] = [0, 60, 360, 720, 1440, 'today']
export const DEFAULT_TRAIL: TrailLength = 60
export const MAX_TRAIL_MINUTES = 1440

/** "1 hour", "6 hours", "Today", "Off": the trail length as the app shows it. */
export function trailLabel(length: TrailLength): string {
  if (length === 'today') return 'Today'
  if (length === 0) return 'Off'
  if (length < 60) return `${length} minutes`
  const hours = length / 60
  return hours === 1 ? '1 hour' : `${hours} hours`
}

/** Where the trail starts (ms since epoch), or null when trails are off. "Today" is local midnight. */
export function trailStart(length: TrailLength, now: number): number | null {
  if (length === 'today') return new Date(now).setHours(0, 0, 0, 0)
  return length === 0 ? null : now - length * 60 * 1000
}

/** How many minutes back a trail goes: a day at most, which also covers "today". */
export function trailMinutes(length: TrailLength): number {
  return length === 'today' ? MAX_TRAIL_MINUTES : length
}

/**
 * The option closest to a saved value, since the options change over time: by ratio, so a
 * 5-minute trail becomes an hour rather than off. Undefined when it isn't a trail length at all.
 */
export function nearestTrail(value: unknown): TrailLength | undefined {
  if (value === 'today' || value === 0) return value
  if (typeof value !== 'number' || !(value > 0)) return undefined
  const lengths = TRAIL_OPTIONS.filter((option): option is number => typeof option === 'number' && option > 0)
  return lengths.reduce((best, option) => (Math.abs(Math.log(option / value)) < Math.abs(Math.log(best / value)) ? option : best))
}
/**
 * History always covers at least this much, to tell what an asset is doing right now and how long
 * it's been in one place. A day at the park still fits; longer stays show "since before".
 */
export const HISTORY_MIN_MINUTES = 180

/**
 * How many minutes of history a trail needs: its own, and HISTORY_MIN_MINUTES before its start, so
 * the trail is worked out there as it would be anywhere else (see trailView in trailGeometry.ts): a
 * walk under way when it starts, a stay long enough to be one, a fix it can check against the one
 * before. With trails off, enough to tell what each asset is doing.
 */
export function historyMinutes(length: TrailLength): number {
  return trailMinutes(length) + HISTORY_MIN_MINUTES
}
export const MAX_HISTORY_MINUTES = MAX_TRAIL_MINUTES + HISTORY_MIN_MINUTES

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
 * Adds live positions (with or without a GPS fix) to the trails, keeping `minutes` of history before
 * each asset's newest (as of `now`), as it's loaded (see historyStart).
 */
export function extendTrails(trails: Trails, updates: LiveUpdate[], minutes: number, now: number): Trails {
  let next = trails
  for (const update of updates) {
    if (update.kind !== 'position') continue
    const time = Date.parse(update.location.fixTime)
    const since = Math.min(time, now) - minutes * 60 * 1000
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
