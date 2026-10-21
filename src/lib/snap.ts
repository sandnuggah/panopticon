// Snap to paths, part by part: a walk snapped where it went along streets and paths, and drawn as
// recorded where it didn't (a dog running about on the grass). The server gets one matched line for
// the whole walk from Valhalla (matching.server.ts); this keeps the parts of it the fixes agree with.
// No runtime imports, so Node can run the tests directly.

/**
 * `park`: the fix is in a park, where a path nearby says less (see parks.ts). `anchor`: not a fix but
 * the stay the walk starts or ends at (see matching.ts). `time` in ms, for gaps between fixes.
 */
export type Point = { lat: number; lon: number; park?: boolean; anchor?: boolean; time?: number }

/** A fix this close to the matched line was on a street or path... */
const ON_PATH_METERS = 20
/** ...and this many of them in a row make a stretch worth snapping. */
const MIN_RUN = 3
/**
 * In a park a dog runs about on the grass, often within 20 m of a path it isn't on: there, a fix
 * counts as on the path only this close, and a stretch needs this many in a row.
 */
const PARK_ON_PATH_METERS = 8
const PARK_MIN_RUN = 5
/** Of the stretches of line about as near (within this), a fix belongs to the earliest. */
const TIE_METERS = 5
/**
 * Between two fixes in a row, the line is followed only while it's no longer than this many times as
 * far as the dog went, plus DETOUR_METERS; longer, it's a detour no fix was on (the matcher going out
 * to a street and back), drawn straight across instead.
 */
const DETOUR_FACTOR = 1.5
const DETOUR_METERS = 20
/**
 * Legs nobody saw: between a stay and the first or last fix (the tracker asleep, or waking up on the
 * way), and between fixes at least UNSEEN_MS apart. The way is a guess there, and the way along paths
 * is a better one than straight across (a bridge, a building, a slope in between), so these follow the
 * line, or a route (see unseenLegs), unless it's longer than UNSEEN_FACTOR times as far plus UNSEEN_METERS.
 */
const UNSEEN_MS = 2 * 60 * 1000
const UNSEEN_FACTOR = 4
const UNSEEN_METERS = 50

/** Where a fix lands on the line: after which vertex, how far along that segment, and how far off. */
type Foot = { segment: number; t: number; point: Point; off: number }

/**
 * The walk as drawn: the matched line along the stretches where at least MIN_RUN fixes in a row lie
 * within ON_PATH_METERS of it (in parks PARK_MIN_RUN within PARK_ON_PATH_METERS), and the fixes as
 * recorded in between. Null when no stretch does, so the walk is drawn as recorded. Fixes are
 * matched to the line in order, so a walk out and back along the same path takes each way in turn;
 * where the line detours between two fixes, it's cut across (see DETOUR_FACTOR).
 */
export function snapAlong(points: Point[], line: Point[]): Point[] | null {
  if (points.length < 2 || line.length < 2) return null
  // Each fix's foot on the line, no earlier than the last fix that was on it.
  const feet: Foot[] = []
  let from = 0
  for (const point of points) {
    const foot = footOnLine(point, line, from)
    feet.push(foot)
    if (foot.off <= ON_PATH_METERS) from = foot.segment
  }
  const onPath = feet.map((foot, index) => foot.off <= (points[index]!.park ? PARK_ON_PATH_METERS : ON_PATH_METERS))

  const result: Point[] = []
  let snapped = false
  let i = 0
  while (i < points.length) {
    let j = i
    while (j < points.length && onPath[j]) j++
    const needed = points.slice(i, j).some((point) => point.park) ? PARK_MIN_RUN : MIN_RUN
    if (j - i >= needed) {
      // Foot to foot along the line, passing over a foot that falls back along it (a near tie with
      // the way out, on the way back) unless it's the last.
      result.push(feet[i]!.point)
      let went = 0
      let last = i
      for (let k = i + 1; k < j; k++) {
        went += metres(points[k - 1]!, points[k]!)
        if (k < j - 1 && behind(feet[k]!, feet[last]!)) continue
        const unseen = isUnseen(points[last]!, points[k]!)
        for (const point of lineBetween(line, feet[last]!, feet[k]!, went, unseen)) if (point !== result.at(-1)) result.push(point)
        went = 0
        last = k
      }
      if (feet[j - 1]!.point !== result.at(-1)) result.push(feet[j - 1]!.point)
      snapped = true
      i = j
    } else {
      result.push(points[i]!)
      i++
    }
  }
  return snapped ? result : null
}

/**
 * The way from one fix's foot to a later one's, `went` metres on by the fixes: the line's vertices
 * between them, or the two feet where the line goes back or detours (see DETOUR_FACTOR; for a leg
 * nobody saw, UNSEEN_FACTOR), to be joined straight.
 */
function lineBetween(line: Point[], start: Foot, end: Foot, went: number, unseen: boolean): Point[] {
  if (behind(end, start)) return [start.point, end.point]
  const vertices = line.slice(start.segment + 1, end.segment + 1)
  const way = [start.point, ...vertices, end.point]
  const length = way.slice(1).reduce((sum, point, index) => sum + metres(way[index]!, point), 0)
  return length > tooLong(went, unseen) ? [start.point, end.point] : vertices
}

/** How long a way between two points `went` metres apart may be before it's a detour. */
function tooLong(went: number, unseen: boolean): number {
  return unseen ? went * UNSEEN_FACTOR + UNSEEN_METERS : went * DETOUR_FACTOR + DETOUR_METERS
}

function isUnseen(a: Point, b: Point): boolean {
  return !!a.anchor || !!b.anchor || (a.time !== undefined && b.time !== undefined && Math.abs(b.time - a.time) >= UNSEEN_MS)
}

/**
 * The legs of a drawn walk (from snapAlong, or the points as recorded) still straight across where
 * nobody saw the way: from or to an anchor drawn as it is, or between two fixes drawn as recorded at
 * least UNSEEN_MS apart. As indexes into `drawn`, of each leg's start.
 */
export function unseenLegs(points: Point[], drawn: Point[]): number[] {
  const given = new Set(points)
  const legs: number[] = []
  for (let k = 0; k + 1 < drawn.length; k++) {
    const [a, b] = [drawn[k]!, drawn[k + 1]!]
    const anchored = (a.anchor && given.has(a)) || (b.anchor && given.has(b))
    if (anchored || (given.has(a) && given.has(b) && isUnseen(a, b))) legs.push(k)
  }
  return legs
}

/** Whether a route between two points is short enough to draw for a leg nobody saw (see UNSEEN_FACTOR). */
export function routeFits(a: Point, b: Point, routeMetres: number): boolean {
  return routeMetres <= tooLong(metres(a, b), true)
}

function behind(foot: Foot, than: Foot): boolean {
  return foot.segment < than.segment || (foot.segment === than.segment && foot.t < than.t)
}

function metres(a: Point, b: Point): number {
  return Math.hypot((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180) * 111_320, (b.lat - a.lat) * 110_540)
}

/** The nearest point on the line to a point, from segment `from` on; of near ties, the earliest. */
function footOnLine(point: Point, line: Point[], from: number): Foot {
  const metresPerDegreeLon = Math.cos((point.lat * Math.PI) / 180) * 111_320
  const xy = (q: Point) => [(q.lon - point.lon) * metresPerDegreeLon, (q.lat - point.lat) * 110_540] as const
  const candidates: Foot[] = []
  for (let segment = Math.max(0, from); segment < line.length - 1; segment++) {
    const [ax, ay] = xy(line[segment]!)
    const [bx, by] = xy(line[segment + 1]!)
    const [dx, dy] = [bx - ax, by - ay]
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0
    const a = line[segment]!
    const b = line[segment + 1]!
    candidates.push({
      segment,
      t,
      point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t },
      off: Math.hypot(ax + t * dx, ay + t * dy),
    })
  }
  const nearest = Math.min(...candidates.map((foot) => foot.off))
  return candidates.find((foot) => foot.off <= nearest + TIE_METERS)!
}
