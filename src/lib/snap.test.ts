import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { drawWalk, routeFits, snapAlong, strayCandidates, strayed, timedWalk, type Point } from './snap.ts'

// Positions in metres east/north of a start point; the matched line is a path going east, then north.
const START = { lat: 59.31, lon: 18.07 }
const METERS_PER_DEGREE_LAT = 110_540
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const at = (east: number, north: number): Point => ({
  lat: START.lat + north / METERS_PER_DEGREE_LAT,
  lon: START.lon + east / METERS_PER_DEGREE_LON,
})
const PATH = [at(0, 0), at(100, 0), at(200, 0), at(200, 100), at(200, 200)]
/** Metres east and north of the start, for checking results. */
const metres = (point: Point) => [
  Math.round((point.lon - START.lon) * METERS_PER_DEGREE_LON),
  Math.round((point.lat - START.lat) * METERS_PER_DEGREE_LAT),
]
/**
 * A line's shape, in metres: without the points along a straight stretch of it (each fix's foot on the
 * line is a point of it, see timedWalk), so what's checked is where it goes.
 */
const shape = (points: Point[]) => straight(points.map(metres))
/** Metres without the points along a straight stretch. */
const straight = (points: number[][]) =>
  points.filter((point, index, all) => {
    const [before, after] = [all[index - 1], all[index + 1]]
    if (!before || !after) return true
    const cross = (point[0]! - before[0]!) * (after[1]! - before[1]!) - (point[1]! - before[1]!) * (after[0]! - before[0]!)
    const between =
      Math.min(before[0]!, after[0]!) <= point[0]! &&
      point[0]! <= Math.max(before[0]!, after[0]!) &&
      Math.min(before[1]!, after[1]!) <= point[1]! &&
      point[1]! <= Math.max(before[1]!, after[1]!)
    return !(between && Math.abs(cross) <= Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!))
  })

describe('snapAlong', () => {
  test('a walk along the path is the path, from its first fix to its last', () => {
    const walk = [at(10, 5), at(60, -4), at(120, 6), at(195, 50), at(203, 150)]
    assert.deepEqual(
      shape(snapAlong(walk, PATH)!),
      straight([
        [10, 0],
        [100, 0],
        [200, 0],
        [200, 100],
        [200, 150],
      ]),
    )
  })

  test('a run on the grass stays as recorded, between snapped stretches', () => {
    const walk = [at(0, 2), at(40, -3), at(80, 4), at(110, 60), at(150, 70), at(198, 120), at(201, 160), at(199, 190)]
    const result = shape(snapAlong(walk, PATH)!)
    // Along the path to the third fix, then the two fixes on the grass, then along the path again.
    assert.deepEqual(result, [
      [0, 0],
      [80, 0],
      [110, 60],
      [150, 70],
      [200, 120],
      [200, 190],
    ])
  })

  test('in a park, a path nearby counts only when the fixes keep close to it', () => {
    // Running on the grass 12–15 m beside a park path: snapped outside a park, as recorded inside one.
    const onGrass = [at(10, 14), at(40, -12), at(70, 15), at(100, -13), at(130, 12), at(160, -14)]
    assert.notEqual(snapAlong(onGrass, PATH), null)
    assert.equal(
      snapAlong(
        onGrass.map((point) => ({ ...point, park: true })),
        PATH,
      ),
      null,
    )
    // Walking along the park path: still snapped.
    const onPath = [at(10, 3), at(40, -2), at(70, 4), at(100, -3), at(130, 2), at(160, -4)]
    assert.deepEqual(
      shape(
        snapAlong(
          onPath.map((point) => ({ ...point, park: true })),
          PATH,
        )!,
      ),
      straight([
        [10, 0],
        [100, 0],
        [160, 0],
      ]),
    )
  })

  test('too few fixes near the path: drawn as recorded', () => {
    assert.equal(snapAlong([at(0, 60), at(50, 1), at(100, -2), at(150, 70)], PATH), null)
  })

  test('out and back along the same path takes each way in turn', () => {
    const outAndBack = [at(0, 0), at(100, 0), at(200, 0), at(100, 0), at(0, 0)]
    const walk = [at(5, 3), at(60, -2), at(150, 4), at(190, -3), at(120, 2), at(40, -1), at(5, 2)]
    // Out to the far end and back: the line's turn at 200 m is kept, not cut short.
    assert.deepEqual(
      shape(snapAlong(walk, outAndBack)!),
      straight([
        [5, 0],
        [100, 0],
        [200, 0],
        [100, 0],
        [5, 0],
      ]),
    )
  })

  test('a detour out to a street and back, between two fixes, is cut across', () => {
    // The matcher took the path down to a street 35 m off and back up, where the fixes went straight
    // on: from the fix before, straight to the one on the way back up.
    const detour = [at(0, 0), at(50, 0), at(65, -35), at(80, 0), at(150, 0)]
    const walk = [at(10, 2), at(30, -3), at(50, 1), at(73, -12), at(95, 2), at(120, -1)]
    assert.deepEqual(
      shape(snapAlong(walk, detour)!),
      straight([
        [10, 0],
        [50, 0],
        [75, -13],
        [80, 0],
        [120, 0],
      ]),
    )
  })

  test('a leg nobody saw follows the line further than a detour would', () => {
    // The same line out to a street and back, but a gap in the fixes before the fix after it.
    const detour = [at(0, 0), at(50, 0), at(65, -35), at(80, 0), at(150, 0)]
    const walk = [at(10, 2), at(30, -3), at(50, 1), { ...at(95, 2), unseen: true }, at(120, -1)]
    assert.deepEqual(
      shape(snapAlong(walk, detour)!),
      straight([
        [10, 0],
        [50, 0],
        [65, -35],
        [80, 0],
        [120, 0],
      ]),
    )
  })
})

describe('drawWalk', () => {
  const home: Point = { ...at(0, -40), anchor: true }

  test('from a stay to the first fix, and across a gap in the fixes, are legs nobody saw', () => {
    const fixes: Point[] = [at(10, 2), at(30, -3), { ...at(90, 5), unseen: true }]
    const walk = drawWalk([home, ...fixes], [])
    assert.equal(walk.snapped, false)
    assert.deepEqual(walk.unseen, [0, 2])
  })

  test('a leg nobody saw too short for a route is drawn straight', () => {
    const fixes: Point[] = [at(10, 2), { ...at(15, 2), unseen: true }]
    assert.deepEqual(drawWalk(fixes, []).unseen, [])
  })

  test('a fix or two that strayed from the line are left out, and the line goes on', () => {
    // The third fix jumped 30 m off, onto a street below: the walk goes on along the line.
    const walk = [at(10, 2), at(40, -3), at(70, 1), at(110, -30), at(140, 2), at(170, -1), at(199, 60)]
    assert.deepEqual(strayCandidates(walk, PATH), [[3]])
    assert.deepEqual(
      shape(drawWalk(walk, PATH, new Set([3])).points),
      straight([
        [10, 0],
        [100, 0],
        [200, 0],
        [200, 60],
      ]),
    )
  })

  test('between a stay and the line, a fix that strayed is left out too', () => {
    const walk = [home, at(60, -30), at(100, 3), at(140, -2), at(180, 1)]
    assert.deepEqual(strayCandidates(walk, PATH), [[1]])
    const drawn = drawWalk(walk, PATH, new Set([1]))
    assert.deepEqual(
      shape(drawn.points),
      straight([
        [0, -40],
        [100, 0],
        [180, 0],
      ]),
    )
    assert.deepEqual(drawn.unseen, [0], 'from the stay to the line: a route')
    assert.equal(drawn.strayed, true, 'drawn without it, even where nothing else changes')
    assert.equal(drawWalk(walk, PATH).strayed, false)
  })

  test('a fix strays near another way, or far from any outside a park; between, or on the grass in a park, it stays', () => {
    const walk: Point[] = [at(10, 2), at(40, -3), at(70, -40), at(100, 3), at(130, -45), at(160, 2), at(190, -40), at(220, 2)]
    const groups = [[2], [4], [6]]
    const metres = (fromWay: number[]) => (index: number) => fromWay[index] ?? 0
    // 5 m from a street below; 30 m out in a courtyard; 18 m off: anything.
    assert.deepEqual([...strayed(walk, groups, metres([0, 0, 5, 0, 30, 0, 18, 0]))], [2, 4])
    const inPark = walk.map((point) => ({ ...point, park: true }))
    assert.deepEqual([...strayed(inPark, groups, metres([0, 0, 5, 0, 30, 0, 18, 0]))], [2], 'a lawn in a park')
    assert.deepEqual([...strayed(walk, [[4, 5]], metres([0, 0, 0, 0, 30, 18]))], [], 'only when each of them did')
  })

  test("a fix that strayed doesn't break the stretch on the line it jumped out of", () => {
    // Two fixes on the line, a stray, two more: four in a row on the line, strays aside.
    const walk = [at(20, 2), at(50, -2), at(80, -30), at(110, 1), at(140, -1)]
    assert.equal(drawWalk(walk, PATH).snapped, false, 'two and two: neither enough')
    assert.equal(drawWalk(walk, PATH, new Set([2])).snapped, true)
  })

  test('where the dog stood a while is no stray', () => {
    const walk = [at(10, 2), at(40, -3), { ...at(70, -40), stood: true }, at(100, 3), at(130, -4)]
    assert.deepEqual(strayCandidates(walk, PATH), [])
  })

  test('three fixes off the line in a row are no strays', () => {
    const walk = [at(0, 2), at(40, -3), at(80, 4), at(110, 60), at(150, 70), at(170, 65), at(198, 120), at(201, 160), at(199, 190)]
    assert.deepEqual(strayCandidates(walk, PATH), [])
  })

  test('in a park too, a fix may stray: off the line is more than 20 m off it, anywhere', () => {
    const walk = [at(10, 2), at(40, -12), at(70, -30), at(100, 12), at(130, -4)].map((point) => ({ ...point, park: true }))
    assert.deepEqual(strayCandidates(walk, PATH), [[2]])
  })

  test('a route fits up to twice as far plus 20 m, counting the bits from the points to it', () => {
    // 100 m apart; round a block 40 m north: 180 m, and 10 m from each point to where it starts and ends.
    const round = (north: number) => [at(0, 10), at(0, north), at(100, north), at(100, 10)]
    assert.equal(routeFits(at(0, 0), at(100, 0), round(45)), true, '200 m in all')
    assert.equal(routeFits(at(0, 0), at(100, 0), round(65)), false, '240 m')
    assert.equal(routeFits(at(0, 0), at(100, 0), []), false, 'none')
  })
})

describe('how it was drawn, and when', () => {
  const home: Point = { ...at(0, -40), anchor: true }
  const timed = (points: Point[]) => points.map((point, index) => ({ ...point, time: 1_000_000 + index * 30_000 }))

  test('each point says how the way to it was drawn: along the line, as recorded, cut across', () => {
    // Along the path, then on the grass and back to it; the second walk cuts a detour.
    const grass = [at(0, 2), at(40, -3), at(80, 4), at(110, 60), at(150, 70), at(198, 120), at(201, 160), at(199, 190)]
    // Along the path to the third fix, the two on the grass as recorded, then along the path again.
    assert.deepEqual(drawWalk(grass, PATH).how, [
      'recorded',
      'matched',
      'matched',
      'recorded',
      'recorded',
      'recorded',
      'matched',
      'matched',
    ])
    const detour = [at(0, 0), at(50, 0), at(65, -35), at(80, 0), at(150, 0)]
    const walk = [at(10, 2), at(30, -3), at(50, 1), at(73, -12), at(95, 2), at(120, -1)]
    const drawn = drawWalk(walk, detour)
    assert.deepEqual(drawn.how, ['recorded', 'matched', 'matched', 'cut', 'matched', 'matched', 'matched'])
    assert.deepEqual(drawn.source, [0, 1, 2, 3, -1, 4, 5], 'the fixes, or their feet, they stand for; -1 for the line')
  })

  test('a leg nobody saw is unseen, or routed where there was a route', () => {
    const fixes: Point[] = [at(10, 2), at(30, -3), { ...at(90, 5), unseen: true }]
    const walk = drawWalk([home, ...fixes], [])
    assert.deepEqual(walk.how, ['recorded', 'unseen', 'recorded', 'unseen'])
    const points = timedWalk(timed([home, ...fixes]), walk, [[at(5, -20)], null])
    assert.deepEqual(
      points.map((point) => point.how),
      ['recorded', 'routed', 'routed', 'recorded', 'unseen'],
    )
  })

  test('each fix’s foot at the fix’s time; the line’s own points between, by how far along they are', () => {
    // Fixes 30 s apart at 10, 50 and 150 m east along the path, which has a point at 100 m.
    const walk = [at(10, 2), at(50, -3), at(150, 4)]
    const points = timedWalk(timed(walk), drawWalk(walk, PATH), [])
    assert.deepEqual(points.map(metres), [
      [10, 0],
      [50, 0],
      [100, 0],
      [150, 0],
    ])
    // The path's point at 100 m: halfway from the second fix's foot to the third's.
    assert.deepEqual(
      points.map((point) => point.time),
      [1_000_000, 1_030_000, 1_045_000, 1_060_000],
    )
  })
})

describe('round trips and breaks', () => {
  test('a stay at the start is put on the first stretch of a round trip, not on the way back beside it', () => {
    // Out east along one side of a street and back along the other, 10 m north; home 12 m north of the start.
    const line = [at(0, 0), at(200, 0), at(200, 10), at(0, 10)]
    const home = { ...at(0, 12), anchor: true }
    const fixes = [at(50, 0), at(100, 0), at(150, 0), at(200, 5), at(150, 10), at(100, 10), at(50, 10)]
    const walk = drawWalk([home, ...fixes], line)
    assert.equal(walk.how.filter((way) => way === 'matched').length > 3, true, 'out and back along the line')
    assert.deepEqual(metres(walk.points[0]!), [0, 0], 'from the start of the line')
  })

  test("not across a break between two of Valhalla's trips: straight between the fixes there", () => {
    // Two trips: east along y = 0, then on along y = 50, with the gap between them a break.
    const line = [at(0, 0), at(100, 0), at(100, 50), at(200, 50)]
    const fixes = [at(30, 0), at(60, 0), at(90, 0), at(105, 25), at(110, 50), at(140, 50), at(170, 50)]
    assert.ok(
      drawWalk(fixes, line).points.some((point) => metres(point).join() === '100,50'),
      'along the chord without the break',
    )
    const broken = drawWalk(fixes, line, new Set(), new Set([1]))
    assert.ok(!broken.points.some((point) => metres(point).join() === '100,50'), 'not along it with')
    assert.ok(
      broken.points.some((point) => metres(point).join() === '105,25'),
      'and a fix beside the break drawn as recorded, not put on it',
    )
  })
})
