import { stayHopId, walkId } from './matching.ts'
import { trailPlaces, type Place } from './places.ts'
import { classifyTrail, latestOutingStart, stayDots, type LatLon, type StayDot, type TrailPiece } from './segments.ts'
import type { SnappedLine, SnappedLines } from './snapLines.ts'
import { trailProfile, type TrackerKind } from './tracker.ts'
import type { TrailPoint, Trails } from './trail.ts'

// What the map draws of the trail (see trailLayers.ts), worked out here without maplibre, so Node can
// run it: the tests, and the trail replay (dev/replay.ts) that scores what the map shows over time.
// Walking as a line from dot to dot; rides through their fixes; stays as dots, the walks running
// through them, so a day reads as one path. The latest outing (since the last long stay, see
// latestOutingStart) is in front, and older ones fade into the background; within each, the older
// parts are fainter.

/** Walking is drawn in short pieces so the trail can fade with age, oldest faintest. */
const HOPS_PER_PIECE = 3

/** A point as drawn, with a time, for fading. */
export type TimedPoint = LatLon & { time: number }

/**
 * An asset's trail to draw: its pieces, the time it fades from (its first fix, or the first piece drawn,
 * see trailFrom) and its newest fix's, and when its latest outing began.
 */
export type TrailView = { pieces: TrailPiece[]; oldest: number; newest: number; outing: number | null }

/** Each asset's trail to draw, by asset id. */
export type TrailViews = Record<number, TrailView>

/**
 * What trailViews remembers of each asset's trail, so one whose points, places and tracker haven't
 * changed isn't worked out again.
 */
export type TrailViewCache = Map<
  number,
  { points: TrailPoint[]; places: Place[]; tracker: TrackerKind | undefined; view: TrailView | null }
>

/**
 * An asset's trail as drawn. `walks`: each move, from the dot of the stay before to the one after, and
 * each hop between the dots of two stays next to each other; with the id Snap to paths knows it by
 * (see matching.ts), and whether it follows a snapped line (`snapped`), as answered for the walk as it
 * is now (`current`; see snapLines.ts). `rides`: their legs, with GPS or without. `opacity`: how faint
 * a part of it is, by its time.
 */
export type DrawnTrail = {
  walks: { key: string; points: TimedPoint[]; snapped: boolean; current: boolean; hop: boolean }[]
  rides: { kind: 'vehicle' | 'underground'; points: TimedPoint[] }[]
  dots: StayDot[]
  opacity: (time: number) => number
}

/**
 * The trail of all of an asset's points (its history and what's come live since), worked out once as
 * they come, with its places and its kind of tracker's profile; drawn from where the trail starts with
 * trailFrom. Worked out from only the points the trail shows, it would change as its start moves on:
 * a walk cut in two, a stay too short to be one, a fix the trail can't check any more (see
 * withoutUnconfirmed in segments.ts).
 */
export function trailView(points: Trails[number], places: Place[], id: number, tracker: TrackerKind | undefined): TrailView | null {
  const fixes = points.filter((point) => point.valid)
  if (fixes.length === 0) return null
  const pieces = classifyTrail(points, { showWandering: true, places: trailPlaces(places, id), profile: trailProfile(tracker) })
  return { pieces, oldest: fixes[0]!.time, newest: fixes.at(-1)!.time, outing: latestOutingStart(pieces) }
}

/**
 * Each asset's trail worked out from all of its points (see trailView), as the trails are now: only
 * an asset whose points (a new array when they change, see extendTrails), places or kind of tracker
 * changed is worked out again; the rest come from `cache`, which forgets assets no longer there.
 */
export function trailViews(
  trails: Trails,
  places: Place[],
  trackers: Record<number, TrackerKind | undefined>,
  cache: TrailViewCache = new Map(),
): TrailViews {
  const views: TrailViews = {}
  for (const id of cache.keys()) if (!(id in trails)) cache.delete(id)
  for (const [key, points] of Object.entries(trails)) {
    const id = Number(key)
    let entry = cache.get(id)
    if (entry?.points !== points || entry.places !== places || entry.tracker !== trackers[id]) {
      entry = { points, places, tracker: trackers[id], view: trailView(points, places, id, trackers[id]) }
      cache.set(id, entry)
    }
    if (entry.view) views[id] = entry.view
  }
  return views
}

/** Each trail drawn from `start` on (see trailFrom); none when trails are off (`start` null). */
export function shownTrails(views: TrailViews, start: number | null): TrailViews {
  const shown: TrailViews = {}
  if (start === null) return shown
  for (const [id, view] of Object.entries(views)) {
    const trail = trailFrom(view, firstShown(view.pieces, start))
    if (trail) shown[Number(id)] = trail
  }
  return shown
}

/**
 * What shownTrails depends on, as a string, for keeping its result while the trail's start moves on
 * but the same pieces are drawn (see firstShown): each asset's first piece drawn.
 */
export function shownKey(views: TrailViews, start: number | null): string {
  if (start === null) return 'off'
  return Object.entries(views)
    .map(([id, view]) => `${id}:${firstShown(view.pieces, start)}`)
    .join(' ')
}

/**
 * Where a trail drawn from `from` on starts, as an index in its pieces: at the first piece that ends at
 * or after it, drawn whole, so a walk that began before is drawn all of it; or at the stay it set off
 * from (or hopped over from, see drawTrail), so it starts at that stay's dot. As the trail's start
 * moves on, only whole pieces drop off. The pieces' length when none ends after `from`.
 */
export function firstShown(pieces: TrailPiece[], from: number): number {
  const index = pieces.findIndex((piece) => pieceEnd(piece) >= from)
  if (index < 0) return pieces.length
  const piece = pieces[index]!
  const setOff = index > 0 && pieces[index - 1]!.kind === 'stay' && (piece.kind !== 'stay' || piece.from >= from)
  return setOff ? index - 1 : index
}

/** The trail drawn from its piece at `first` on (see firstShown), fading from there; null when that's none of it. */
export function trailFrom(view: TrailView, first: number): TrailView | null {
  if (first >= view.pieces.length) return null
  if (first <= 0) return view
  const pieces = view.pieces.slice(first)
  return { ...view, pieces, oldest: pieceStart(pieces[0]!) }
}

function pieceStart(piece: TrailPiece): number {
  return piece.kind === 'move' ? piece.points[0]!.time : piece.kind === 'stay' ? piece.from : piece.from.time
}

function pieceEnd(piece: TrailPiece): number {
  return piece.kind === 'move' ? piece.points.at(-1)!.time : piece.kind === 'stay' ? piece.to : piece.to.time
}

/** Draws a trail, along the lines Snap to paths has for its walks (by walk id, see snapLines.ts). */
export function drawTrail({ pieces, oldest, newest, outing: latest }: TrailView, lines: Record<string, SnappedLine> = {}): DrawnTrail {
  // The latest outing from 0.55 at its start to 0.95 at its newest point; older ones from 0.12 to 0.25.
  const outing = latest ?? oldest
  const along = (time: number, from: number, to: number) => (to > from ? Math.min(1, Math.max(0, (time - from) / (to - from))) : 1)
  const opacity = (time: number) => (time >= outing ? 0.55 + 0.4 * along(time, outing, newest) : 0.12 + 0.13 * along(time, oldest, outing))
  const drawn: DrawnTrail = { walks: [], rides: [], dots: [], opacity }
  const stayIndexes = pieces.flatMap((piece, index) => (piece.kind === 'stay' ? [index] : []))
  const { dots, dotOf } = stayDots(stayIndexes.map((index) => pieces[index] as Extract<TrailPiece, { kind: 'stay' }>))
  drawn.dots = dots
  /** The dot of the stay at `index` in the pieces, if there's a stay there. */
  const dotAt = (index: number) => {
    const stay = stayIndexes.indexOf(index)
    return stay < 0 ? undefined : dots[dotOf[stay]!]!
  }
  pieces.forEach((piece, index) => {
    if (piece.kind === 'move') {
      // From the dot of the stay before to the dot of the stay after, so the path is unbroken.
      const [before, after] = [dotAt(index - 1), dotAt(index + 1)]
      const key = walkId(piece.points)
      const line = lineOf(lines, key)
      const points = [
        ...(before ? [{ ...before.center, time: piece.points[0]!.time }] : []),
        ...(line?.points ?? piece.points),
        ...(after ? [{ ...after.center, time: piece.points.at(-1)!.time }] : []),
      ]
      drawn.walks.push({ key, points, snapped: !!line, current: line?.current ?? false, hop: false })
    } else if (piece.kind === 'stay') {
      // Straight on from another stop, a few dozen metres off (pottering about a park): a line
      // between their dots, along the way Snap to paths routed, if it did.
      const [before, here] = [dotAt(index - 1), dotAt(index)!]
      if (before && before !== here) {
        const hop = [
          { ...before.center, time: piece.from },
          { ...here.center, time: piece.from },
        ]
        const key = stayHopId(pieces[index - 1] as Extract<TrailPiece, { kind: 'stay' }>, piece)
        const line = lineOf(lines, key)
        // From dot to dot, as walks are: a dot can be at another of its stays.
        const points = line ? [hop[0]!, ...line.points, hop[1]!] : hop
        drawn.walks.push({ key, points, snapped: !!line, current: line?.current ?? false, hop: true })
      }
    } else {
      // Through the fixes on the way; legs without GPS are straight lines, dotted.
      for (const leg of piece.legs) drawn.rides.push({ kind: leg.kind, points: leg.points })
    }
  })
  return drawn
}

type Position = [number, number]

export type TrailFeature = {
  type: 'Feature'
  properties: { id: number; kind: string; opacity: number; minutes?: number }
  geometry: { type: 'LineString'; coordinates: Position[] } | { type: 'Point'; coordinates: Position }
}

export type TrailFeatures = { type: 'FeatureCollection'; features: TrailFeature[] }

/**
 * GeoJSON for the trail layers. `paws` holds the walking only, in longer pieces than `trail`:
 * paw prints are spaced 44 px apart, so short pieces would show none.
 */
export function toTrailFeatures(trails: TrailViews, lines: SnappedLines = {}): { trail: TrailFeatures; paws: TrailFeatures } {
  const trail: TrailFeature[] = []
  const paws: TrailFeature[] = []
  for (const [key, view] of Object.entries(trails)) {
    const id = Number(key)
    const { walks, rides, dots, opacity } = drawTrail(view, lines[id])
    const line = (kind: string, points: TimedPoint[], time: number): TrailFeature => ({
      type: 'Feature',
      properties: { id, kind, opacity: opacity(time) },
      geometry: { type: 'LineString', coordinates: points.map((point) => [point.lon, point.lat]) },
    })
    for (const walk of walks) {
      // A hop between two dots is all of one time: one piece.
      const step = walk.hop ? walk.points.length : HOPS_PER_PIECE
      for (let i = 0; i < walk.points.length - 1; i += step) {
        const chunk = walk.points.slice(i, i + step + 1)
        trail.push(line('move', chunk, chunk.at(-1)!.time))
      }
      paws.push(line('move', walk.points, walk.points.at(-1)!.time))
    }
    for (const ride of rides) trail.push(line(ride.kind, ride.points, ride.points.at(-1)!.time))
    for (const dot of dots) {
      trail.push({
        type: 'Feature',
        properties: { id, kind: 'stay', opacity: opacity(dot.to), minutes: dot.ms / 60_000 },
        geometry: { type: 'Point', coordinates: [dot.center.lon, dot.center.lat] },
      })
    }
  }
  return {
    trail: { type: 'FeatureCollection', features: trail },
    paws: { type: 'FeatureCollection', features: paws },
  }
}

/** A walk's line to draw, if it has one with any points: a walk of strays left out is drawn as recorded. */
function lineOf(lines: Record<string, SnappedLine>, key: string): SnappedLine | undefined {
  const line = lines[key]
  return line && line.points.length > 0 ? line : undefined
}
