import { DEFAULT_TRAIL_PROFILE, distance, type LatLon, type TrailPiece, type TrailProfile } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Snap to paths: walking stretches of the trail can be snapped to streets and paths by a
// map-matching service (Valhalla, see matching.server.ts). This part is shared by the browser, which
// picks the walks worth snapping, and the server, which does the snapping. No runtime imports beyond
// segments.ts, so Node can run the tests directly.

/** Points closer than this to the previous kept one are standing-still jitter, dropped before matching. */
const JITTER_METERS = 15
/** A walk must get at least this far from where it started: wandering around a yard isn't snapped. */
const MIN_WALK_METERS = 75
/** Two stays next to each other this far apart are separate dots, with a hop between them that nobody saw. */
const STAY_HOP_METERS = 40

/** At most this many walks per request, each at most this many points. */
export const MAX_WALKS_PER_REQUEST = 20
export const MAX_POINTS_PER_WALK = 400

/**
 * `park`: in a park, where snapping is stricter (see snap.ts). `anchor`: the stay the walk starts or
 * ends at, not a fix. `gap`: after a gap in the tracker's fixes, so nobody saw the way here.
 */
export type MatchablePoint = LatLon & { time: number; park?: boolean; anchor?: boolean; gap?: boolean }

/** Identifies a walk by its first and last fix and how many it has; it changes as the walk grows. */
export function walkKey(points: TrailPoint[]): string {
  return `${points[0]!.time}-${points.at(-1)!.time}-${points.length}`
}

/** Identifies the hop between two stays next to each other, drawn as a line between their dots. */
export function stayHopKey(from: { to: number }, to: { from: number }): string {
  return `stays-${from.to}-${to.from}`
}

/**
 * The walks in these pieces worth snapping, without jitter: stays are already carved out, and a
 * walk must get somewhere from where it began (out and back counts) and have at least 3 points. A
 * walk from or to a stay starts or ends at the stay's middle, where the map draws it from (its dot),
 * marked as an anchor: leaving home then follows the street from the door, not a straight line to
 * the first fix outside, which comes once the tracker wakes (see drawWalk in snap.ts). A fix at least
 * the tracker's `gapMs` after the one before is marked as after a gap, for the same reason.
 */
export function matchableWalks(
  pieces: TrailPiece[],
  inPark: (point: LatLon) => boolean = () => false,
  profile: TrailProfile = DEFAULT_TRAIL_PROFILE,
): { key: string; points: MatchablePoint[] }[] {
  const walks: { key: string; points: MatchablePoint[] }[] = []
  pieces.forEach((piece, index) => {
    const [before, after] = [pieces[index - 1], pieces[index + 1]]
    if (piece.kind === 'stay' && before?.kind === 'stay' && distance(before.center, piece.center) >= STAY_HOP_METERS) {
      // Straight from one stay to the next (the walk between them was part of one): routed, if anything.
      const points = [
        { ...before.center, time: before.to, anchor: true },
        { ...piece.center, time: piece.from, anchor: true },
      ]
      walks.push({ key: stayHopKey(before, piece), points })
    }
    if (piece.kind !== 'move') return
    const [from, to] = [before?.kind === 'stay' ? before.center : null, after?.kind === 'stay' ? after.center : null]
    // Anywhere along it, not just at its end: a walk round the block and home again counts.
    const start = from ?? piece.points[0]!
    if (![...piece.points, ...(to ? [to] : [])].some((point) => distance(start, point) >= MIN_WALK_METERS)) return
    const kept = [piece.points[0]!]
    for (const point of piece.points.slice(1)) if (distance(kept.at(-1)!, point) >= JITTER_METERS) kept.push(point)
    if (kept.at(-1) !== piece.points.at(-1)) kept.push(piece.points.at(-1)!)
    // Room for the two stays' middles within the limit.
    const points: MatchablePoint[] = kept.slice(-(MAX_POINTS_PER_WALK - 2)).map(({ lat, lon, time }, index, all) => {
      const point: MatchablePoint = { lat, lon, time }
      if (inPark({ lat, lon })) point.park = true
      if (index > 0 && time - all[index - 1]!.time >= profile.gapMs) point.gap = true
      return point
    })
    if (from) points.unshift({ ...from, time: points[0]!.time - 1000, anchor: true })
    if (to) points.push({ ...to, time: points.at(-1)!.time + 1000, anchor: true })
    if (points.length < 3) return
    walks.push({ key: walkKey(piece.points), points })
  })
  return walks
}
