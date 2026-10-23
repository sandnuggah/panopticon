import { DEFAULT_TRAIL_PROFILE, distance, isWeak, type LatLon, type TrailPiece, type TrailProfile } from './segments.ts'
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
/** A fix standing for at least this many more left out as jitter is where the dog stood a while: no stray. */
const STOOD_FIXES = 3
/**
 * A walk's stays are timed this long before its first fix and after its last at least, or as long as
 * the way takes at a walk (WALK_METERS_PER_SECOND): Valhalla turns down a way that would take far longer
 * than the time between two points, so 1 s, as before, broke the match at the door, and the leg
 * from home was routed instead (on a week of Kofi's, 5.0 km routed and 8.3 km matched; now 0.9 and 13.3).
 */
const ANCHOR_MS = 60_000
const WALK_METERS_PER_SECOND = 1.4

/** At most this many walks per request, each at most this many points. */
export const MAX_WALKS_PER_REQUEST = 20
export const MAX_POINTS_PER_WALK = 400

/**
 * `park`: in a park, where snapping is stricter (see snap.ts). `anchor`: the stay the walk starts or
 * ends at, not a fix. `unseen`: nobody saw the way here from the fix before. `stood`: the dog stood
 * here a while (see matchableWalks).
 */
export type MatchablePoint = LatLon & { time: number; park?: boolean; anchor?: boolean; unseen?: boolean; stood?: boolean }

/** Identifies a walk by its first fix, so it's the same walk as it grows. */
export function walkId(points: TrailPoint[]): string {
  return `walk-${points[0]!.time}`
}

/** Identifies the hop between two stays next to each other, drawn as a line between their dots. */
export function stayHopId(from: { to: number }, to: { from: number }): string {
  return `stays-${from.to}-${to.from}`
}

/**
 * Identifies a version of a walk as it's asked for: which fixes, which of them are in a park or come
 * after a leg nobody saw, and where the stays it starts or ends at are. It changes as the walk grows,
 * as its stays' middles move, and as parks show up on the map.
 */
export function walkSignature(points: MatchablePoint[]): string {
  const text = points
    .map(
      (point) =>
        `${point.time}${point.park ? 'p' : ''}${point.unseen ? 'u' : ''}${point.stood ? 's' : ''}${point.anchor ? `a${point.lat.toFixed(6)},${point.lon.toFixed(6)}` : ''}`,
    )
    .join(' ')
  // FNV-1a: short enough to keep and compare, and versions of one walk differ in their ends and count anyway.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return `${points[0]!.time}-${points.at(-1)!.time}-${points.length}-${(hash >>> 0).toString(36)}`
}

/** A walk worth snapping (see matchableWalks): which walk, which version of it, and its points as asked for. */
export type MatchableWalk = { id: string; signature: string; points: MatchablePoint[] }

/**
 * The walks in these pieces not worth snapping (see matchableWalks), with their fixes: never asked
 * for, but one that had a line as a longer walk keeps it (see snapLines.ts). No signature.
 */
export function otherWalks(pieces: TrailPiece[], worth: MatchableWalk[]): MatchableWalk[] {
  const asked = new Set(worth.map((walk) => walk.id))
  return pieces.flatMap((piece) =>
    piece.kind === 'move' && !asked.has(walkId(piece.points))
      ? [{ id: walkId(piece.points), signature: '', points: piece.points.map(({ lat, lon, time }) => ({ lat, lon, time })) }]
      : [],
  )
}

/**
 * The walks in these pieces worth snapping, without jitter, and thinned out evenly when there are too
 * many points (a walk of over three hours from an ST-904L): stays are already carved out, and a
 * walk must get somewhere from where it began (out and back counts) and have at least 3 points. A
 * walk from or to a stay starts or ends at the stay's middle, where the map draws it from (its dot),
 * marked as an anchor: leaving home then follows the street from the door, not a straight line to
 * the first fix outside, which comes once the tracker wakes (see drawWalk in snap.ts). For the same
 * reason a fix is marked `unseen` when, between it and the fix kept before it, the fixes as recorded
 * have a gap of at least the tracker's `gapMs` (as kept, a dog standing still has none).
 * (A long hop to or from a weak fix used to be marked too: its only clear effect, on a week of Kofi's,
 * was a 454 m loop round the block made up from 208 m of weak fixes.)
 */
export function matchableWalks(
  pieces: TrailPiece[],
  inPark: (point: LatLon) => boolean = () => false,
  profile: TrailProfile = DEFAULT_TRAIL_PROFILE,
): MatchableWalk[] {
  const walks: MatchableWalk[] = []
  pieces.forEach((piece, index) => {
    const [before, after] = [pieces[index - 1], pieces[index + 1]]
    if (piece.kind === 'stay' && before?.kind === 'stay' && distance(before.center, piece.center) >= STAY_HOP_METERS) {
      // Straight from one stay to the next (the walk between them was part of one): routed, if anything.
      const points = [
        { ...before.center, time: before.to, anchor: true },
        { ...piece.center, time: piece.from, anchor: true },
      ]
      walks.push({ id: stayHopId(before, piece), signature: walkSignature(points), points })
    }
    if (piece.kind !== 'move') return
    const [from, to] = [before?.kind === 'stay' ? before.center : null, after?.kind === 'stay' ? after.center : null]
    // Anywhere along it, not just at its end: a walk round the block and home again counts.
    const start = from ?? piece.points[0]!
    if (![...piece.points, ...(to ? [to] : [])].some((point) => distance(start, point) >= MIN_WALK_METERS)) return
    const kept = [piece.points[0]!]
    // How many fixes left out as jitter each kept one stands for.
    const left = new Map<TrailPoint, number>()
    for (const point of piece.points.slice(1)) {
      if (distance(kept.at(-1)!, point) >= JITTER_METERS) kept.push(point)
      else left.set(kept.at(-1)!, (left.get(kept.at(-1)!) ?? 0) + 1)
    }
    if (kept.at(-1) !== piece.points.at(-1)) {
      // The last fix is kept after all: one fewer left out.
      left.set(kept.at(-1)!, left.get(kept.at(-1)!)! - 1)
      kept.push(piece.points.at(-1)!)
    }
    // Room for the two stays' middles within the limit.
    const room = MAX_POINTS_PER_WALK - 2
    const thinned =
      kept.length <= room ? kept : Array.from({ length: room }, (_, k) => kept[Math.round((k * (kept.length - 1)) / (room - 1))]!)
    // A gap nobody saw is between fixes as recorded, not as kept: a dog standing still leaves its
    // fixes out as jitter, which isn't a gap (on a week of Kofi's, 18 of 29 such marks were that).
    const gaps = new Set(piece.points.filter((fix, index) => index > 0 && fix.time - piece.points[index - 1]!.time >= profile.gapMs))
    const points: MatchablePoint[] = thinned.map((fix, index) => {
      const { lat, lon, time } = fix
      const point: MatchablePoint = { lat, lon, time }
      if (inPark({ lat, lon })) point.park = true
      if ((left.get(fix) ?? 0) >= STOOD_FIXES) point.stood = true
      // Any gap between the kept fix before and this one.
      const before = thinned[index - 1]
      if (before && piece.points.some((raw) => raw.time > before.time && raw.time <= time && gaps.has(raw))) point.unseen = true
      return point
    })
    const walkMs = (a: LatLon, b: LatLon) => Math.max(ANCHOR_MS, Math.round((distance(a, b) / WALK_METERS_PER_SECOND) * 1000))
    if (from) points.unshift({ ...from, time: points[0]!.time - walkMs(from, points[0]!), anchor: true })
    if (to) points.push({ ...to, time: points.at(-1)!.time + walkMs(points.at(-1)!, to), anchor: true })
    if (points.length < 3) return
    walks.push({ id: walkId(piece.points), signature: walkSignature(points), points })
  })
  return walks
}
