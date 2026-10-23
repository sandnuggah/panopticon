// Snap to paths, part by part: a walk snapped where it went along streets and paths, and drawn as
// recorded where it didn't (a dog running about on the grass). The server gets one matched line for
// the whole walk from Valhalla (matching.server.ts); this keeps the parts of it the fixes agree with.
// No runtime imports, so Node can run the tests directly.

/**
 * `park`: the fix is in a park, where a path nearby says less (see parks.ts). `anchor`: not a fix but
 * the stay the walk starts or ends at. `unseen`: nobody saw the way here from the fix before (a gap in
 * the fixes; from matchableWalks in matching.ts). `stood`: the dog stood here a while, the fix standing
 * for several left out as jitter, so it's no stray.
 */
export type Point = { lat: number; lon: number; park?: boolean; anchor?: boolean; unseen?: boolean; stood?: boolean }

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
 * ...unless there's no shorter way to walk: the line no longer than Valhalla's walking route between
 * the two feet this many times, plus DETOUR_ROUTE_METERS, is the way the dog went (round a corner, along
 * a bridge), and followed after all (see noDetour), if it's at most NO_DETOUR_FACTOR times as far as
 * straight. Farther, one of the two fixes is likelier off across a block than the dog round it: on a
 * week of Kofi's, of 8 such cuts, the 4 at 1.6–1.9 times were round a corner or along the bridge, the
 * 4 at 2.5–3.5 times down the steps to the park and back, round a block a courtyard fix was in, and the like.
 */
const DETOUR_ROUTE_FACTOR = 1.2
const DETOUR_ROUTE_METERS = 10
const NO_DETOUR_FACTOR = 2
/**
 * Legs nobody saw: between a stay and the first or last fix (the tracker asleep, or waking up on the
 * way), and to a fix marked `unseen`. The way is a guess there, and the way along paths is a
 * better one than straight across (a bridge, a building, a slope in between), so these follow the
 * line, or a route (see drawWalk), unless it's longer than UNSEEN_FACTOR times as far plus UNSEEN_METERS,
 * counting the bits from the leg's ends to the route. Until October 2026 it was 4 times plus 50 m: on
 * a week of Kofi's, 21 legs were drawn twice as long as straight or more, the worst a 23 m leg as 149 m.
 */
const UNSEEN_FACTOR = 2
const UNSEEN_METERS = 20
/** The foot of the stay a walk starts at is on the line's first this many metres. */
const ANCHOR_METERS = 50

/**
 * A fix or two in a row more than ON_PATH_METERS off the line jumped there, GPS error the matcher,
 * keeping the walk connected, didn't believe, when each is either this close to a way (which the line
 * then doesn't take: a street below a bridge, the other side of a wall), or, outside a park, farther
 * than STRAY_FAR_METERS from any (a courtyard, a block, water: on a week of Kofi's, fixes in the
 * courtyards north of Home 26–40 m from a way, in the canal 33 m). They're left out (see strayed).
 * In a park, away from every way is the grass: kept. More in a row, the matcher may be the one that's
 * wrong: kept. And where the dog stood a while (`stood`), that's no jump: kept, with the fixes in the
 * same run off the line (on a week of Kofi's, 9 fixes over 3.5 minutes were left out this way, after
 * the map had shown them).
 */
const STRAY_FIXES = 2
const STRAY_NEAR_WAY_METERS = 10
const STRAY_FAR_METERS = 25
/** A leg nobody saw shorter than this is drawn straight: a route says no more. */
const MIN_ROUTE_METERS = 20

/** Where a fix lands on the line: after which vertex, how far along that segment, and how far off. */
type Foot = { segment: number; t: number; point: Point; off: number }

/**
 * How the way to a point of a walk was drawn: along the matched line; straight between fixes, as
 * recorded; cut straight across where the line went somewhere no fix was (see DETOUR_FACTOR); along a
 * walking route, or straight, across a leg nobody saw (see UNSEEN_FACTOR).
 */
export type How = 'matched' | 'recorded' | 'cut' | 'routed' | 'unseen'

/** A point of a walk as drawn, with when (see timedWalk) and how the way to it was drawn. */
export type SnappedPoint = { lat: number; lon: number; time: number; how: How }

/**
 * A walk as drawn, from drawWalk. For each point: which of the walk's points it stands for (`source`:
 * a fix or its foot on the line; -1 for the line's own vertices) and how the way to it was drawn
 * (`how`). `snapped`: some of it follows the line. `strayed`: some fixes were left out. `unseen`: the
 * legs still straight across where nobody saw the way, by the index in `points` of each leg's start,
 * for a route. `detours`: the legs cut straight across a detour, the same way, with the line's way
 * between them (`way`, its vertices) and how long it is, in case it's no detour (see noDetour).
 */
export type DrawnWalk = {
  points: Point[]
  source: number[]
  how: How[]
  snapped: boolean
  strayed: boolean
  unseen: number[]
  detours: Detour[]
}
export type Detour = { leg: number; way: Point[]; length: number }

/**
 * The walk as drawn: the matched line along the stretches where at least MIN_RUN fixes in a row lie
 * within ON_PATH_METERS of it (in parks PARK_MIN_RUN within PARK_ON_PATH_METERS), and the fixes as
 * recorded in between, but for `strays` (see strayCandidates), left out. A stay (an anchor) near the
 * line is snapped onto it like a fix. Fixes are matched to the line in order, so a walk out and back along the same path takes
 * each way in turn; where the line detours between two fixes, it's cut across (see DETOUR_FACTOR).
 */
export function drawWalk(
  points: Point[],
  line: Point[],
  strays: ReadonlySet<number> = new Set(),
  breaks: ReadonlySet<number> = new Set(),
): DrawnWalk {
  const feet = feetOnLine(points, line, breaks)
  const snapped = snappedFixes(points, feet, strays)
  // How far the dog went, from fix to fix: strays aside, as it never went out to them.
  const along = points.map(() => 0)
  let previous = -1
  points.forEach((point, k) => {
    if (strays.has(k)) return
    along[k] = previous < 0 ? 0 : along[previous]! + metres(points[previous]!, point)
    previous = k
  })

  const drawn: Point[] = []
  // The index of the point each drawn point stands for: a fix, its foot, or -1 for the line's own vertices.
  const source: number[] = []
  const how: How[] = []
  const emit = (point: Point, index: number, way: How) => {
    const last = drawn.at(-1)
    // A foot can fall on a vertex: one point, standing for the fix.
    if (last && last.lat === point.lat && last.lon === point.lon) {
      if (source.at(-1)! < 0) source[source.length - 1] = index
      return
    }
    drawn.push(point)
    source.push(index)
    how.push(way)
  }
  const detours: Detour[] = []
  const kept = points.map((_, index) => index).filter((index) => !strays.has(index))
  for (let n = 0; n < kept.length;) {
    const i = kept[n]!
    if (!snapped[i]) {
      emit(points[i]!, i, 'recorded')
      n++
      continue
    }
    // Snapped fixes in a row, strays aside: foot to foot along the line, passing over a foot that falls
    // back along it (a near tie with the way out, on the way back) unless it's the last.
    let m = n
    while (m < kept.length && snapped[kept[m]!]) m++
    const row = kept.slice(n, m)
    emit(feet![i]!.point, i, 'recorded')
    let last = i
    // How the way to the last foot was drawn.
    let arriving: How = 'recorded'
    row.slice(1).forEach((k, index) => {
      if (index < row.length - 2 && behind(feet![k]!, feet![last]!)) return
      const way = lineBetween(line, feet![last]!, feet![k]!, along[k]! - along[last]!, isUnseen(points, last, k), breaks)
      const leg: How = way.followed ? 'matched' : 'cut'
      if (way.detour) detours.push({ leg: drawn.length - 1, way: way.detour.vertices, length: way.detour.length })
      for (const point of way.points) {
        const source = point === feet![last]!.point ? last : point === feet![k]!.point ? k : -1
        emit(point, source, source === last ? arriving : leg)
      }
      arriving = leg
      last = k
    })
    emit(feet![row.at(-1)!]!.point, row.at(-1)!, arriving)
    n = m
  }

  const unseen: number[] = []
  for (let k = 0; k + 1 < drawn.length; k++) {
    const [a, b] = [source[k]!, source[k + 1]!]
    if (a < 0 || b < 0 || !isUnseen(points, a, b)) continue
    how[k + 1] = 'unseen'
    if (metres(drawn[k]!, drawn[k + 1]!) >= MIN_ROUTE_METERS) unseen.push(k)
  }
  // A leg that turns out nobody saw (a stay, or an unseen fix, merged into a foot before it) gets a route, not the line.
  const cut = detours.filter((detour) => how[detour.leg + 1] !== 'unseen')
  return { points: drawn, source, how, snapped: snapped.some(Boolean), strayed: strays.size > 0, unseen, detours: cut }
}

/**
 * The walk as drawn (see drawWalk) with its legs nobody saw along a walking route where there is one
 * (`routes`, by leg, as in `walk.unseen`) and the line followed after all where it was no detour
 * (`noDetours`, as in `walk.detours`), and when each point was: a point standing for one of the
 * walk's points at that point's time, the rest in between by how far along the way they are.
 */
export function timedWalk(
  points: (Point & { time: number })[],
  walk: DrawnWalk,
  routes: (Point[] | null)[],
  noDetours: boolean[] = [],
): SnappedPoint[] {
  const timed: { lat: number; lon: number; time: number | null; how: How }[] = []
  const followed = (k: number) => walk.detours.find((detour, index) => detour.leg === k && noDetours[index])
  walk.points.forEach((point, k) => {
    const how = k > 0 && routes[walk.unseen.indexOf(k - 1)] ? 'routed' : k > 0 && followed(k - 1) ? 'matched' : walk.how[k]!
    const source = walk.source[k]!
    timed.push({ lat: point.lat, lon: point.lon, time: source >= 0 ? points[source]!.time : null, how })
    for (const step of routes[walk.unseen.indexOf(k)] ?? []) timed.push({ lat: step.lat, lon: step.lon, time: null, how: 'routed' })
    for (const step of followed(k)?.way ?? []) timed.push({ lat: step.lat, lon: step.lon, time: null, how: 'matched' })
  })
  // Between two points with times, by distance; before the first or after the last, theirs.
  const along = timed.map(() => 0)
  for (let k = 1; k < timed.length; k++) along[k] = along[k - 1]! + metres(timed[k - 1]!, timed[k]!)
  let before = -1
  for (let k = 0; k < timed.length; k++) {
    if (timed[k]!.time === null) continue
    for (let j = before + 1; j < k; j++) {
      const [from, to] = before < 0 ? [k, k] : [before, k]
      const span = along[to]! - along[from]!
      const share = span > 0 ? (along[j]! - along[from]!) / span : 0
      timed[j]!.time = timed[from]!.time! + (timed[to]!.time! - timed[from]!.time!) * share
    }
    before = k
  }
  const last = before >= 0 ? timed[before]!.time : 0
  return timed.map((point) => ({ ...point, time: Math.round(point.time ?? last!) }))
}

/** The walk as drawn (see drawWalk), or null when no stretch of it is snapped, so it's drawn as recorded. */
export function snapAlong(points: Point[], line: Point[]): Point[] | null {
  const walk = drawWalk(points, line)
  return walk.snapped ? walk.points : null
}

/**
 * The fixes that may have strayed (see STRAY_FIXES), in groups: a fix or two in a row off the line
 * (stays aside). Whether they did depends on how far each is from a way, which only Valhalla knows
 * (see strayed, and matching.server.ts).
 */
export function strayCandidates(points: Point[], line: Point[], breaks: ReadonlySet<number> = new Set()): number[][] {
  const feet = feetOnLine(points, line, breaks)
  if (!feet) return []
  const off = (index: number) => !points[index]!.anchor && feet[index]!.off > ON_PATH_METERS
  const groups: number[][] = []
  for (let i = 0; i < points.length;) {
    let j = i
    while (j < points.length && off(j)) j++
    // Where the dog stood a while, neither it nor the fixes either side of it in the run jumped there.
    const stood = points.slice(i, j).some((point) => point.stood)
    if (j > i && j - i <= STRAY_FIXES && !stood) groups.push(points.slice(i, j).map((_, k) => i + k))
    i = Math.max(j, i + 1)
  }
  return groups
}

/** The fixes that strayed, of strayCandidates' groups, by how far each is from the nearest way (metres). */
export function strayed(points: Point[], groups: number[][], fromWay: (index: number) => number): Set<number> {
  const astray = (index: number) => fromWay(index) <= STRAY_NEAR_WAY_METERS || (fromWay(index) > STRAY_FAR_METERS && !points[index]!.park)
  return new Set(groups.filter((group) => group.every(astray)).flat())
}

/**
 * Each point's foot on the line, no earlier than the last fix that was on it, never on a break
 * between two of Valhalla's trips (`breaks`, by segment); the stay a walk starts at on a segment
 * starting within the line's first ANCHOR_METERS (on a round trip, its foot was landing on the way
 * back, so the whole walk home was drawn as recorded). The stay it ends at needs no such rule: it
 * comes after the fixes, so its foot is looked for from theirs on (left out on a week of Kofi's,
 * nothing changed). Null without a line.
 */
function feetOnLine(points: Point[], line: Point[], breaks: ReadonlySet<number> = new Set()): Foot[] | null {
  if (line.length < 2) return null
  const along = [0]
  for (let k = 1; k < line.length; k++) along.push(along[k - 1]! + metres(line[k - 1]!, line[k]!))
  const feet: Foot[] = []
  let from = 0
  points.forEach((point, index) => {
    const start = point.anchor && index === 0
    const notBreak = (segment: number) => !breaks.has(segment)
    const foot =
      (start ? footOnLine(point, line, 0, (segment) => notBreak(segment) && along[segment]! <= ANCHOR_METERS) : undefined) ??
      footOnLine(point, line, from, notBreak)!
    feet.push(foot)
    // A stay doesn't move on where the fixes' feet are looked for.
    if (!point.anchor && foot.off <= ON_PATH_METERS) from = foot.segment
  })
  return feet
}

/**
 * Which fixes are snapped: in stretches of at least MIN_RUN in a row on the line (in parks
 * PARK_MIN_RUN), strays aside (left out, a stray doesn't break the stretch it jumped out of).
 */
function snappedFixes(points: Point[], feet: Foot[] | null, strays: ReadonlySet<number>): boolean[] {
  const kept = points.map((_, index) => index).filter((index) => !strays.has(index))
  const onPath = (index: number) => !!feet && feet[index]!.off <= (points[index]!.park ? PARK_ON_PATH_METERS : ON_PATH_METERS)
  const snapped = points.map(() => false)
  for (let i = 0; i < kept.length;) {
    let j = i
    while (j < kept.length && onPath(kept[j]!)) j++
    const run = kept.slice(i, j)
    const needed = run.some((index) => points[index]!.park) ? PARK_MIN_RUN : MIN_RUN
    if (run.length >= needed) for (const index of run) snapped[index] = true
    i = Math.max(j, i + 1)
  }
  return snapped
}

/**
 * The way from one fix's foot to a later one's, `went` metres on by the fixes: the line's vertices
 * between them and the later foot (`followed`), or the two feet where the line goes back or detours
 * (see DETOUR_FACTOR; for a leg nobody saw, UNSEEN_FACTOR), to be joined straight.
 */
function lineBetween(
  line: Point[],
  start: Foot,
  end: Foot,
  went: number,
  unseen: boolean,
  breaks: ReadonlySet<number> = new Set(),
): { points: Point[]; followed: boolean; detour?: { vertices: Point[]; length: number } } {
  const cut = { points: [start.point, end.point], followed: false }
  if (behind(end, start)) return cut
  // Across a break between two of Valhalla's trips: straight, as recorded.
  for (let segment = start.segment; segment <= end.segment; segment++) if (breaks.has(segment)) return cut
  const vertices = line.slice(start.segment + 1, end.segment + 1)
  const way = [start.point, ...vertices, end.point]
  const length = way.slice(1).reduce((sum, point, index) => sum + metres(way[index]!, point), 0)
  // With the later foot, so each fix on the line is a point of it, at the fix's time (see timedWalk).
  if (length <= tooLong(went, unseen)) return { points: [...vertices, end.point], followed: true }
  // A leg nobody saw gets a route of its own (see routeFits); a detour may turn out none (see noDetour).
  const same = (a: Point, b: Point) => a.lat === b.lat && a.lon === b.lon
  const between = vertices.filter((vertex) => !same(vertex, start.point) && !same(vertex, end.point))
  return unseen ? cut : { ...cut, detour: { vertices: between, length } }
}

/** How long a way between two points `went` metres apart may be before it's a detour. */
function tooLong(went: number, unseen: boolean): number {
  return unseen ? went * UNSEEN_FACTOR + UNSEEN_METERS : went * DETOUR_FACTOR + DETOUR_METERS
}

/** Whether nobody saw the way from one point to a later one: a stay at either end, or an unseen leg on the way. */
function isUnseen(points: Point[], from: number, to: number): boolean {
  if (points[from]!.anchor || points[to]!.anchor) return true
  for (let k = from + 1; k <= to; k++) if (points[k]!.unseen) return true
  return false
}

/**
 * Whether the line cut across as a detour between two feet (`length` long) is no detour after all:
 * about as long as the walking route between them (`route`, counting the bits from the feet to it),
 * the shortest way there, and not too far round (see DETOUR_ROUTE_FACTOR).
 */
export function noDetour(a: Point, b: Point, route: Point[], length: number): boolean {
  if (route.length === 0 || length > metres(a, b) * NO_DETOUR_FACTOR) return false
  const way = route.slice(1).reduce((sum, point, index) => sum + metres(route[index]!, point), 0)
  return length <= (metres(a, route[0]!) + way + metres(route.at(-1)!, b)) * DETOUR_ROUTE_FACTOR + DETOUR_ROUTE_METERS
}

/**
 * Whether a route between two points is short enough to draw for a leg nobody saw (see UNSEEN_FACTOR),
 * counting the bits from the points to where it starts and ends.
 */
export function routeFits(a: Point, b: Point, route: Point[]): boolean {
  if (route.length === 0) return false
  const length = route.slice(1).reduce((sum, point, index) => sum + metres(route[index]!, point), 0)
  return metres(a, route[0]!) + length + metres(route.at(-1)!, b) <= tooLong(metres(a, b), true)
}

function behind(foot: Foot, than: Foot): boolean {
  return foot.segment < than.segment || (foot.segment === than.segment && foot.t < than.t)
}

function metres(a: Point, b: Point): number {
  return Math.hypot((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180) * 111_320, (b.lat - a.lat) * 110_540)
}

/** The nearest point on the line to a point, from segment `from` on, of those `allowed`; of near ties, the earliest. */
function footOnLine(point: Point, line: Point[], from: number, allowed: (segment: number) => boolean = () => true): Foot | undefined {
  const metresPerDegreeLon = Math.cos((point.lat * Math.PI) / 180) * 111_320
  const xy = (q: Point) => [(q.lon - point.lon) * metresPerDegreeLon, (q.lat - point.lat) * 110_540] as const
  const candidates: Foot[] = []
  for (let segment = Math.max(0, from); segment < line.length - 1; segment++) {
    if (!allowed(segment)) continue
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
  return candidates.find((foot) => foot.off <= nearest + TIE_METERS)
}
