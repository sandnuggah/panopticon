import type { TimedPoint } from './trailGeometry.ts'

// Trails that run along the same street, drawn side by side, like a metro map's lines, instead of on
// top of each other: two dogs on the same street, the way home walked every day, a walk's way out
// and back. Each line is cut into short pieces; a piece with others alongside it (another line's, or
// its own further along) takes a lane, and the map shifts it that many line widths to its right
// (trailLayers.ts, maplibre's `line-offset`, in pixels, so the lanes stay apart at every zoom). Lanes
// go by time: the first line there stays on the street, later ones take a lane on the side of it
// they're on, the next one out, so a new walk never moves an older one. No runtime imports, so Node
// can run the tests.

/** A line to lay out: its points in order, with their times (which line came first, where). */
export type LaneLine<T> = { points: TimedPoint[]; data: T }

/** A stretch of a line in one lane: 0 on the street, 1 a line's width to its right, -1 to its left. */
export type LanePiece<T> = { points: TimedPoint[]; data: T; lane: number }

/** Lines this close to each other (metres) run along the same street... */
const ALONGSIDE_METERS = 8
/** ...when they're about parallel there (the cosine of the angle between them, either way). */
const PARALLEL = 0.85
/** Lines are looked at in pieces at most this long (metres). */
const STEP_METERS = 10
/** A line's own way back counts as alongside it only this far on from where it was (metres). */
const OWN_GAP_METERS = 40
/** A line closer than this (metres) to the first one there is on top of it, on neither side. */
const ON_TOP_METERS = 1
/** A lane shorter than this (metres) is taken for its neighbours': no flicker where lines meet and part. */
const MIN_LANE_METERS = 30

type Segment = { line: number; index: number; x: number; y: number; dx: number; dy: number; along: number; time: number }

/** The lines in pieces, each in its lane (see above). */
export function laneOut<T>(lines: LaneLine<T>[]): LanePiece<T>[] {
  const all = lines.flatMap((line) => line.points)
  if (all.length === 0) return []
  // Metres east and north of their middle: plenty precise across a city.
  const lat0 = all.reduce((sum, point) => sum + point.lat, 0) / all.length
  const [mx, my] = [111_320 * Math.cos((lat0 * Math.PI) / 180), 110_540]
  const dense = lines.map((line) => densify(line.points, mx, my))
  const segments: Segment[][] = dense.map((points, line) => {
    const out: Segment[] = []
    let along = 0
    for (let k = 1; k < points.length; k++) {
      const [a, b] = [points[k - 1]!, points[k]!]
      const [ax, ay, bx, by] = [a.lon * mx, a.lat * my, b.lon * mx, b.lat * my]
      const length = Math.hypot(bx - ax, by - ay)
      out.push({
        line,
        index: k - 1,
        x: (ax + bx) / 2,
        y: (ay + by) / 2,
        dx: length ? (bx - ax) / length : 0,
        dy: length ? (by - ay) / length : 0,
        along,
        time: (a.time + b.time) / 2,
      })
      along += length
    }
    return out
  })
  // A grid of the segments, to find those alongside each in one look at its neighbourhood.
  const cell = (value: number) => Math.floor(value / ALONGSIDE_METERS)
  const grid = new Map<string, Segment[]>()
  for (const segment of segments.flat()) {
    const key = `${cell(segment.x)},${cell(segment.y)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(segment)
  }
  const lanes = segments.map((line) => line.map((segment) => laneOf(segment, grid, cell)))
  return dense.flatMap((points, line) => pieces(points, steady(lanes[line]!, segments[line]!), lines[line]!.data))
}

/** The lane of one segment: by when each line alongside it was there (see above), in its own direction. */
function laneOf(segment: Segment, grid: Map<string, Segment[]>, cell: (value: number) => number): number {
  if (segment.dx === 0 && segment.dy === 0) return 0
  const near: Segment[] = []
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const other of grid.get(`${cell(segment.x) + i},${cell(segment.y) + j}`) ?? []) {
        if (other === segment || (other.dx === 0 && other.dy === 0)) continue
        if (other.line === segment.line && Math.abs(other.along - segment.along) < OWN_GAP_METERS) continue
        if (Math.hypot(other.x - segment.x, other.y - segment.y) > ALONGSIDE_METERS) continue
        if (Math.abs(other.dx * segment.dx + other.dy * segment.dy) < PARALLEL) continue
        near.push(other)
      }
  if (near.length === 0) return 0
  // One pass of each line here: of a line's segments alongside, the ones close together along it are one.
  const passes = [segment]
  for (const other of near.sort((a, b) => a.line - b.line || a.along - b.along)) {
    const last = passes.at(-1)!
    if (last !== segment && last.line === other.line && other.along - last.along <= OWN_GAP_METERS) continue
    passes.push(other)
  }
  passes.sort((a, b) => a.time - b.time || a.line - b.line || a.along - b.along)
  const rank = passes.indexOf(segment)
  if (rank === 0) return 0
  // The first one there stays on the street; each later one goes to the side of it it's on (in the
  // first one's direction), a lane further out than the ones before it on that side: right on top
  // of it, to its right and left in turn.
  const first = passes[0]!
  const side = (pass: Segment, index: number) => {
    const cross = first.dx * (pass.y - first.y) - first.dy * (pass.x - first.x)
    return Math.abs(cross) >= ON_TOP_METERS ? (cross > 0 ? -1 : 1) : index % 2 === 1 ? 1 : -1
  }
  const mine = side(segment, rank)
  const slot = mine * (1 + passes.slice(1, rank).filter((pass, index) => side(pass, index + 1) === mine).length)
  // Its lane to its own right: going the other way, the first one's left is its right.
  return first.dx * segment.dx + first.dy * segment.dy >= 0 ? slot : -slot
}

/** Lanes without flicker: a lane shorter than MIN_LANE_METERS takes the one before it (or after, at the start). */
function steady(lanes: number[], segments: Segment[]): number[] {
  const out = [...lanes]
  for (let i = 0; i < out.length;) {
    let j = i
    while (j + 1 < out.length && out[j + 1] === out[i]) j++
    const length = segments[j]!.along - segments[i]!.along + STEP_METERS
    if (length < MIN_LANE_METERS && (i > 0 || j + 1 < out.length)) {
      const lane = i > 0 ? out[i - 1]! : out[j + 1]!
      for (let k = i; k <= j; k++) out[k] = lane
    }
    i = j + 1
  }
  return out
}

/** The points cut where the lane changes; neighbouring pieces share their end point. */
function pieces<T>(points: TimedPoint[], lanes: number[], data: T): LanePiece<T>[] {
  if (points.length < 2) return [{ points, data, lane: 0 }]
  const out: LanePiece<T>[] = []
  let start = 0
  for (let k = 1; k <= lanes.length; k++) {
    if (k < lanes.length && lanes[k] === lanes[start]) continue
    out.push({ points: points.slice(start, k + 1), data, lane: lanes[start]! })
    start = k
  }
  return out
}

/**
 * The points with ones added between so that no step is longer than STEP_METERS, times in between by
 * distance, each with how the way to it was drawn (the way to the next point it's on).
 */
function densify(points: TimedPoint[], mx: number, my: number): TimedPoint[] {
  const out: TimedPoint[] = []
  points.forEach((point, k) => {
    const before = points[k - 1]
    if (before) {
      const steps = Math.ceil(Math.hypot((point.lon - before.lon) * mx, (point.lat - before.lat) * my) / STEP_METERS)
      for (let s = 1; s < steps; s++) {
        const t = s / steps
        out.push({
          lat: before.lat + (point.lat - before.lat) * t,
          lon: before.lon + (point.lon - before.lon) * t,
          time: before.time + (point.time - before.time) * t,
          ...(point.how && { how: point.how }),
        })
      }
    }
    out.push({ lat: point.lat, lon: point.lon, time: point.time, ...(point.how && { how: point.how }) })
  })
  return out
}
