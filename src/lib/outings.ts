import { distance, isBase, type LatLon, type TrailPiece } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Outings: from leaving a base (one of the asset's places, or a long stay anywhere; see isBase in
// segments.ts) to arriving at the next, walks, stops and rides between. The card lists the day's,
// Stats counts them, and the map draws the latest in front (latestOutingStart), all the same ones.
// Until October 2026 Stats counted walks between any two stops, and disagreed with the card on 4 of a
// week's 8 days. No runtime imports beyond segments.ts, so Node can run the tests directly.

/** An outing that never got this far from where it left isn't one: GPS wandering round a place, not a trip to the pee spot (70–85 m). */
const OUTING_MIN_METERS = 50
/** Points closer than this to the previous kept one are jitter, left out of a walk's length. */
const JITTER_METERS = 15
/**
 * Out, silent this long (as status.ts has a tracker lost): the outing ended with its last report, or
 * with the silence, rather than going on until the next one, hours later.
 */
const SILENT_OUT_MS = 30 * 60 * 1000

/**
 * One outing: when it left and came back (null: still out), how far it walked (metres), how far it
 * got from where it left, and the walks on it (each walk's fixes), for Stats. `began`: it left a base
 * the pieces have, not out when they begin (Stats counts an outing on the day it left). `rode`: some
 * of it was a ride.
 */
export type Outing = {
  from: number
  to: number | null
  walked: number
  furthest: number
  walks: TrailPoint[][]
  began: boolean
  rode: boolean
}

/**
 * The outings in a trail's pieces (classified with the asset's visits to its places), oldest first,
 * as of `now` (by default, its last point). A stay lasts until the next piece begins, so one where the tracker went to sleep is as
 * long as it slept; the last one, until now.
 */
export function outingsOf(pieces: TrailPiece[], now = pieces.length > 0 ? pieceEnd(pieces.at(-1)!) : 0): Outing[] {
  const outings: Outing[] = []
  type Current = { from: number; start: LatLon; walks: TrailPoint[][]; seen: LatLon[]; rode: boolean; began: boolean; last: number }
  let current: Current | null = null
  const close = (to: number | null) => {
    if (!current || (current.walks.length === 0 && !current.rode)) return
    const furthest = Math.max(0, ...current.seen.map((point) => distance(current!.start, point)))
    if (furthest < OUTING_MIN_METERS && !current.rode) return
    const walked = current.walks.reduce((sum, walk) => sum + walkLength(walk), 0)
    outings.push({ from: current.from, to, walked, furthest, walks: current.walks, began: current.began, rode: current.rode })
  }
  pieces.forEach((piece, index) => {
    const next = pieces[index + 1]
    const nextStart = next ? pieceStart(next) : now
    // Silent too long out (asleep at a stay too short to be a base, or the tracker died): over then.
    if (current && pieceStart(piece) - current.last >= SILENT_OUT_MS) {
      close(current.last)
      current = null
    }
    if (piece.kind === 'stay' && isBase(piece, Math.max(piece.to, nextStart))) {
      close(piece.from)
      // It left when the next piece began: after a night there, when the tracker woke.
      current = {
        from: next ? nextStart : piece.to,
        start: piece.dot ?? piece.center,
        walks: [],
        seen: [],
        rode: false,
        began: true,
        // There until it left, asleep or not.
        last: next ? nextStart : piece.to,
      }
      return
    }
    // The trail began out (or out again after a silence): from its first point.
    if (!current) {
      const first = piece.kind === 'move' ? piece.points[0]! : piece.kind === 'stay' ? { ...piece.center, time: piece.from } : piece.from
      current = { from: first.time, start: first, walks: [], seen: [], rode: false, began: false, last: first.time }
    }
    if (piece.kind === 'move') {
      current.walks.push(piece.points)
      current.seen.push(...piece.points)
    } else if (piece.kind !== 'stay') {
      current.rode = true
      current.seen.push(...piece.legs.flatMap((leg) => leg.points))
    }
    current.last = pieceEnd(piece)
  })
  close(current && now - (current as Current).last >= SILENT_OUT_MS ? (current as Current).last : null)
  return outings
}

function pieceStart(piece: TrailPiece): number {
  return piece.kind === 'move' ? piece.points[0]!.time : piece.kind === 'stay' ? piece.from : piece.from.time
}

function pieceEnd(piece: TrailPiece): number {
  return piece.kind === 'move' ? piece.points.at(-1)!.time : piece.kind === 'stay' ? piece.to : piece.to.time
}

/** How far a walk went, along its fixes, without standing-still jitter. */
export function walkLength(fixes: TrailPoint[]): number {
  let length = 0
  let kept = fixes[0]!
  for (const fix of fixes.slice(1)) {
    const step = distance(kept, fix)
    if (step < JITTER_METERS && fix !== fixes.at(-1)) continue
    length += step
    kept = fix
  }
  return length
}

/** "850 m", "21.4 km". */
export function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`
  return `${(metres / 1000).toLocaleString('en', { maximumFractionDigits: 1, minimumFractionDigits: metres < 100_000 ? 1 : 0 })} km`
}

/** The outings that were today, as of `now`: under way, or back since local midnight. */
export function todaysOutings(outings: Outing[], now: number): Outing[] {
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  return outings.filter((outing) => (outing.to ?? now) >= midnight)
}
