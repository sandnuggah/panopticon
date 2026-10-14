// Snap to paths, part by part: a walk snapped where it went along streets and paths, and drawn as
// recorded where it didn't (a dog running about on the grass). The server gets one matched line for
// the whole walk from Valhalla (matching.server.ts); this keeps the parts of it the fixes agree with.
// No runtime imports, so Node can run the tests directly.

export type Point = { lat: number; lon: number }

/** A fix this close to the matched line was on a street or path... */
const ON_PATH_METERS = 20
/** ...and this many of them in a row make a stretch worth snapping. */
const MIN_RUN = 3
/** Of the stretches of line about as near (within this), a fix belongs to the earliest. */
const TIE_METERS = 5

/** Where a fix lands on the line: after which vertex, how far along that segment, and how far off. */
type Foot = { segment: number; t: number; point: Point; off: number }

/**
 * The walk as drawn: the matched line along the stretches where at least MIN_RUN fixes in a row lie
 * within ON_PATH_METERS of it, and the fixes as recorded in between. Null when no stretch does,
 * so the walk is drawn as recorded. Fixes are matched to the line in order, so a walk out and back
 * along the same path takes each way in turn.
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
  const onPath = feet.map((foot) => foot.off <= ON_PATH_METERS)

  const result: Point[] = []
  let snapped = false
  let i = 0
  while (i < points.length) {
    let j = i
    while (j < points.length && onPath[j]) j++
    if (j - i >= MIN_RUN) {
      result.push(...lineBetween(line, feet[i]!, feet[j - 1]!))
      snapped = true
      i = j
    } else {
      result.push(points[i]!)
      i++
    }
  }
  return snapped ? result : null
}

/** The line from one foot to a later one: the two feet and the line's vertices between them. */
function lineBetween(line: Point[], start: Foot, end: Foot): Point[] {
  if (end.segment < start.segment || (end.segment === start.segment && end.t < start.t)) return [start.point, end.point]
  return [start.point, ...line.slice(start.segment + 1, end.segment + 1), end.point]
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
