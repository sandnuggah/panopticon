import { stayHopId, walkId } from './matching.ts'
import type { Place } from './places.ts'
import { placeStays, quietAfter } from './presence.ts'
import { classifyTrail, latestOutingStart, withDots, type LatLon, type StayDot, type TrailPiece } from './segments.ts'
import type { How } from './snap.ts'
import { DEFAULT_TRAIL_COLOR } from './trailColors.ts'
import type { SnappedLine, SnappedLines } from './snapLines.ts'
import { trailProfile, type TrackerKind } from './tracker.ts'
import type { TrailPoint, Trails } from './trail.ts'

// What the map draws of the trail (see trailLayers.ts), worked out here without maplibre, so Node can
// run it: the tests, and the trail replay (dev/replay.ts) that scores what the map shows over time.
// Walking as a line from dot to dot; rides through their fixes; stays as dots, the walks running
// through them, so a day reads as one path. The latest outing (since the last long stay, see
// latestOutingStart) is in front, each walk fainter the older it is, and older outings are in the
// background, as one layer (see trailLayers.ts).

/** A point as drawn, with a time, for fading, and how the way to it was drawn, if snapped (see snap.ts). */
export type TimedPoint = LatLon & { time: number; how?: How }

/** Ways nobody saw, drawn as guesses (thinner and lighter): a walking route, or straight across. */
const GUESSES: ReadonlySet<How> = new Set(['routed', 'unseen'])

/**
 * An asset's trail to draw: its pieces, the time it fades from (its first fix, or the first piece drawn,
 * see trailFrom) and its newest fix's, and when its latest outing began.
 */
export type TrailView = { pieces: TrailPiece[]; oldest: number; newest: number; outing: number | null }

/** Each asset's trail to draw, by asset id. */
export type TrailViews = Record<number, TrailView>

/**
 * What trailViews remembers of each asset's trail, so one whose points, places, tracker and quiet
 * haven't changed isn't worked out again.
 */
export type TrailViewCache = Map<
  number,
  { points: TrailPoint[]; places: Place[]; tracker: TrackerKind | undefined; quiet: boolean; view: TrailView | null }
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
  /** When the latest outing began: what's older is in the background. */
  outing: number
}

/**
 * The trail of all of an asset's points (its history and what's come live since), worked out once as
 * they come, with its places and its kind of tracker's profile; drawn from where the trail starts with
 * trailFrom. Worked out from only the points the trail shows, it would change as its start moves on:
 * a walk cut in two, a stay too short to be one, a fix the trail can't check any more (see
 * withoutUnconfirmed in segments.ts). `quiet`: its tracker has gone quiet since (see quietAssets).
 */
export function trailView(
  points: Trails[number],
  places: Place[],
  id: number,
  tracker: TrackerKind | undefined,
  quiet = false,
): TrailView | null {
  const fixes = points.filter((point) => point.valid)
  if (fixes.length === 0) return null
  const profile = trailProfile(tracker)
  const pieces = withDots(classifyTrail(points, { visits: placeStays(points, places, id, profile, quiet), profile }))
  return { pieces, oldest: fixes[0]!.time, newest: fixes.at(-1)!.time, outing: latestOutingStart(pieces) }
}

/**
 * Each asset's trail worked out from all of its points (see trailView), as the trails are now: only
 * an asset whose points (a new array when they change, see extendTrails), places, kind of tracker or
 * quiet (`quiet`: see quietAssets) changed is worked out again; the rest come from `cache`, which
 * forgets assets no longer there.
 */
export function trailViews(
  trails: Trails,
  places: Place[],
  trackers: Record<number, TrackerKind | undefined>,
  cache: TrailViewCache = new Map(),
  quiet: ReadonlySet<number> = new Set(),
): TrailViews {
  const views: TrailViews = {}
  for (const id of cache.keys()) if (!(id in trails)) cache.delete(id)
  for (const [key, points] of Object.entries(trails)) {
    const id = Number(key)
    let entry = cache.get(id)
    if (entry?.points !== points || entry.places !== places || entry.tracker !== trackers[id] || entry.quiet !== quiet.has(id)) {
      entry = {
        points,
        places,
        tracker: trackers[id],
        quiet: quiet.has(id),
        view: trailView(points, places, id, trackers[id], quiet.has(id)),
      }
      cache.set(id, entry)
    }
    if (entry.view) views[id] = entry.view
  }
  return views
}

/**
 * The assets whose trackers have gone quiet, as of `now`, for as long as a place they went quiet near
 * counts as arrived at (see quietAfter): their trails are worked out again once, when that happens.
 */
export function quietAssets(trails: Trails, trackers: Record<number, TrackerKind | undefined>, now: number): number[] {
  return Object.entries(trails).flatMap(([key, points]) => {
    const lastFix = points.findLast((point) => point.valid)
    return lastFix && now - lastFix.time >= quietAfter(trailProfile(trackers[Number(key)])) ? [Number(key)] : []
  })
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
export function drawTrail(view: TrailView, lines: Record<string, SnappedLine> = {}): DrawnTrail {
  const { oldest, newest, outing: latest } = view
  // Each stay's dot, as worked out for all of the trail (see trailView), or for these pieces.
  const pieces = view.pieces.some((piece) => piece.kind === 'stay' && !piece.dot) ? withDots(view.pieces) : view.pieces
  // The latest outing from 0.55 at its start to 0.95 at its newest point; older ones from 0.12 to 0.25.
  const outing = latest ?? oldest
  const along = (time: number, from: number, to: number) => (to > from ? Math.min(1, Math.max(0, (time - from) / (to - from))) : 1)
  const opacity = (time: number) => (time >= outing ? 0.55 + 0.4 * along(time, outing, newest) : 0.12 + 0.13 * along(time, oldest, outing))
  const drawn: DrawnTrail = { walks: [], rides: [], dots: [], opacity, outing }
  const stayIndexes = pieces.flatMap((piece, index) => (piece.kind === 'stay' ? [index] : []))
  const { dots, dotOf } = shownDots(stayIndexes.map((index) => pieces[index] as Extract<TrailPiece, { kind: 'stay' }>))
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

/**
 * `older`: in an outing before the latest one, drawn in the background; `guess`: a way nobody saw (see
 * GUESSES), or a hop between two dots.
 */
export type TrailFeature = {
  type: 'Feature'
  properties: { id: number; kind: string; color: string; opacity: number; minutes?: number; older?: boolean; guess?: boolean }
  geometry: { type: 'LineString'; coordinates: Position[] } | { type: 'Point'; coordinates: Position }
}

export type TrailFeatures = { type: 'FeatureCollection'; features: TrailFeature[] }

/**
 * GeoJSON for the trail layers: each walk as one line, a feature for each stretch of it seen or
 * guessed, so it has no darker beads where pieces of it overlap; it fades as a whole. `paws` holds the
 * latest outing's walks only, whole.
 */
export function toTrailFeatures(
  trails: TrailViews,
  lines: SnappedLines = {},
  colors: Record<number, string> = {},
): { trail: TrailFeatures; paws: TrailFeatures } {
  const trail: TrailFeature[] = []
  const paws: TrailFeature[] = []
  for (const [key, view] of Object.entries(trails)) {
    const id = Number(key)
    const { walks, rides, dots, opacity, outing } = drawTrail(view, lines[id])
    // Its asset's (see trailColors.ts), for the layers to draw in its shade for a day or night map.
    const color = colors[id] ?? DEFAULT_TRAIL_COLOR
    const line = (kind: string, points: TimedPoint[], time: number, extra: Partial<TrailFeature['properties']> = {}): TrailFeature => ({
      type: 'Feature',
      properties: { id, kind, color, opacity: opacity(time), ...extra },
      geometry: { type: 'LineString', coordinates: points.map((point) => [point.lon, point.lat]) },
    })
    for (const walk of walks) {
      const end = walk.points.at(-1)!.time
      const older = end < outing
      // Each walk at the opacity of its end; stretches of it seen or guessed, cut where that changes.
      const guess = (k: number) => walk.hop || GUESSES.has(walk.points[k]!.how!)
      for (let i = 0; i < walk.points.length - 1;) {
        let j = i + 1
        while (j + 1 < walk.points.length && guess(j + 1) === guess(i + 1)) j++
        trail.push(line('move', walk.points.slice(i, j + 1), end, { ...(older && { older }), ...(guess(i + 1) && { guess: true }) }))
        i = j
      }
      if (!older) paws.push(line('move', walk.points, end))
    }
    for (const ride of rides) trail.push(line(ride.kind, ride.points, ride.points.at(-1)!.time))
    // Not at a place: its pin is there (see placeLayers.ts), and walks run to its way in.
    for (const dot of dots.filter((dot) => !dot.atPlace)) {
      trail.push({
        type: 'Feature',
        properties: { id, kind: 'stay', color, opacity: opacity(dot.to), minutes: dot.ms / 60_000 },
        geometry: { type: 'Point', coordinates: [dot.center.lon, dot.center.lat] },
      })
    }
  }
  return {
    trail: { type: 'FeatureCollection', features: trail },
    paws: { type: 'FeatureCollection', features: paws },
  }
}

/** The dots of the stays drawn: one for each dot they're at (see withDots), fading by the latest of them. */
function shownDots(stays: Extract<TrailPiece, { kind: 'stay' }>[]): { dots: StayDot[]; dotOf: number[] } {
  const dots: StayDot[] = []
  const dotOf: number[] = []
  stays.forEach((stay, index) => {
    const center = stay.dot ?? stay.center
    const at = dots.findIndex((dot) => dot.center.lat === center.lat && dot.center.lon === center.lon)
    if (at < 0) {
      const dot: StayDot = { center, to: stay.to, ms: stay.to - stay.from }
      // A place's, even when only a stay near it is shown: its pin is there.
      if (stay.atPlace || stay.dotAtPlace) dot.atPlace = true
      dotOf[index] = dots.push(dot) - 1
    } else {
      dots[at] = { ...dots[at]!, to: Math.max(dots[at]!.to, stay.to), ms: dots[at]!.ms + stay.to - stay.from }
      dotOf[index] = at
    }
  })
  return { dots, dotOf }
}

/** A walk's line to draw, if it has one with any points: a walk of strays left out is drawn as recorded. */
function lineOf(lines: Record<string, SnappedLine>, key: string): SnappedLine | undefined {
  const line = lines[key]
  return line && line.points.length > 0 ? line : undefined
}
