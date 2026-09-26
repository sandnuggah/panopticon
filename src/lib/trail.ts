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

/** Trail lengths offered in settings, in minutes. 0 turns trails off. */
export const TRAIL_MINUTES_OPTIONS = [0, 5, 10, 15, 30, 60, 180] as const
export const MAX_TRAIL_MINUTES = 180
/** History always covers at least this much, so what an asset is doing right now can be told. */
export const ACTIVITY_MINUTES = 15

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
