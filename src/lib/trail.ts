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
}

/** Oldest point first, per asset id. */
export type Trails = Record<number, TrailPoint[]>

/** How much trail to draw: minutes back from now (0 turns trails off), or everything since midnight. */
export type TrailLength = number | 'today'

/** The lengths offered in settings: the last walk, parts of the day, the whole day, and "today". */
export const TRAIL_OPTIONS: readonly TrailLength[] = [0, 60, 360, 720, 1440, 'today']
export const DEFAULT_TRAIL: TrailLength = 60
export const MAX_TRAIL_MINUTES = 1440

/** Where the trail starts (ms since epoch), or null when trails are off. "Today" is local midnight. */
export function trailStart(length: TrailLength, now: number): number | null {
  if (length === 'today') return new Date(now).setHours(0, 0, 0, 0)
  return length === 0 ? null : now - length * 60 * 1000
}

/** How many minutes of history a trail needs: a day at most, which also covers "today". */
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
  return lengths.reduce((best, option) =>
    Math.abs(Math.log(option / value)) < Math.abs(Math.log(best / value)) ? option : best,
  )
}
/**
 * History always covers at least this much, to tell what an asset is doing right now and how long
 * it's been in one place. A day at the park still fits; longer stays show "since before".
 */
export const HISTORY_MIN_MINUTES = 180

/** Adds live positions (with or without a GPS fix) to the trails and drops points older than `since`. */
export function extendTrails(trails: Trails, updates: LiveUpdate[], since: number): Trails {
  let next = trails
  for (const update of updates) {
    if (update.kind !== 'position') continue
    const time = Date.parse(update.location.fixTime)
    if (time < since) continue
    const trail = next[update.id] ?? []
    const last = trail.at(-1)
    if (last && time <= last.time) continue
    const point: TrailPoint = { lat: update.location.lat, lon: update.location.lon, time, valid: update.valid }
    if (update.cell !== undefined) point.cell = update.cell
    next = { ...next, [update.id]: [...trail.filter((p) => p.time >= since), point] }
  }
  return next
}

export function pruneTrails(trails: Trails, since: number): Trails {
  const next: Trails = {}
  for (const [id, trail] of Object.entries(trails)) {
    const kept = trail.filter((point) => point.time >= since)
    if (kept.length > 0) next[Number(id)] = kept
  }
  return next
}
