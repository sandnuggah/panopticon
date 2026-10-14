import { distance, type LatLon, type TrailPiece } from './segments'
import type { TrailPoint } from './trail'

// Snap to paths: walking stretches of the trail can be snapped to streets and paths by a
// map-matching service (Valhalla, see matching.server.ts). This part is shared by the browser, which
// picks the walks worth snapping, and the server, which does the snapping.

/** Points closer than this to the previous kept one are standing-still jitter, dropped before matching. */
const JITTER_METERS = 15
/** A walk must end at least this far from where it started: wandering around a yard isn't snapped. */
const MIN_WALK_METERS = 75

/** At most this many walks per request, each at most this many points. */
export const MAX_WALKS_PER_REQUEST = 20
export const MAX_POINTS_PER_WALK = 400

export type MatchablePoint = LatLon & { time: number }

/** Identifies a walk by its first and last fix and how many it has; it changes as the walk grows. */
export function walkKey(points: TrailPoint[]): string {
  return `${points[0]!.time}-${points.at(-1)!.time}-${points.length}`
}

/**
 * The walks in these pieces worth snapping, without jitter: stays are already carved out, and a
 * walk must get somewhere and keep at least 3 points. A walk from or to a stay starts or ends at the
 * stay's middle, where the map draws it from (its dot): leaving home then follows the street from
 * the door, not a straight line to the first fix outside, which comes once the tracker wakes.
 */
export function matchableWalks(pieces: TrailPiece[]): { key: string; points: MatchablePoint[] }[] {
  const walks: { key: string; points: MatchablePoint[] }[] = []
  pieces.forEach((piece, index) => {
    if (piece.kind !== 'move' || piece.points.length < 3) return
    if (distance(piece.points[0]!, piece.points.at(-1)!) < MIN_WALK_METERS) return
    const kept = [piece.points[0]!]
    for (const point of piece.points.slice(1)) if (distance(kept.at(-1)!, point) >= JITTER_METERS) kept.push(point)
    if (kept.at(-1) !== piece.points.at(-1)) kept.push(piece.points.at(-1)!)
    if (kept.length < 3) return
    // Room for the two stays' middles within the limit.
    const points: MatchablePoint[] = kept.slice(-(MAX_POINTS_PER_WALK - 2)).map(({ lat, lon, time }) => ({ lat, lon, time }))
    const [before, after] = [pieces[index - 1], pieces[index + 1]]
    if (before?.kind === 'stay') points.unshift({ ...before.center, time: points[0]!.time - 1000 })
    if (after?.kind === 'stay') points.push({ ...after.center, time: points.at(-1)!.time + 1000 })
    walks.push({ key: walkKey(piece.points), points })
  })
  return walks
}
