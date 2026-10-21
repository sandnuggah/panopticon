import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { routeFits, snapAlong, unseenLegs, type Point } from './snap.ts'

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

describe('snapAlong', () => {
  test('a walk along the path is the path, from its first fix to its last', () => {
    const walk = [at(10, 5), at(60, -4), at(120, 6), at(195, 50), at(203, 150)]
    assert.deepEqual(snapAlong(walk, PATH)!.map(metres), [
      [10, 0],
      [100, 0],
      [200, 0],
      [200, 100],
      [200, 150],
    ])
  })

  test('a run on the grass stays as recorded, between snapped stretches', () => {
    const walk = [at(0, 2), at(40, -3), at(80, 4), at(110, 60), at(150, 70), at(198, 120), at(201, 160), at(199, 190)]
    const result = snapAlong(walk, PATH)!.map(metres)
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
      snapAlong(
        onPath.map((point) => ({ ...point, park: true })),
        PATH,
      )!.map(metres),
      [
        [10, 0],
        [100, 0],
        [160, 0],
      ],
    )
  })

  test('too few fixes near the path: drawn as recorded', () => {
    assert.equal(snapAlong([at(0, 60), at(50, 1), at(100, -2), at(150, 70)], PATH), null)
  })

  test('out and back along the same path takes each way in turn', () => {
    const outAndBack = [at(0, 0), at(100, 0), at(200, 0), at(100, 0), at(0, 0)]
    const walk = [at(5, 3), at(60, -2), at(150, 4), at(190, -3), at(120, 2), at(40, -1), at(5, 2)]
    // Out to the far end and back: the line's turn at 200 m is kept, not cut short.
    assert.deepEqual(snapAlong(walk, outAndBack)!.map(metres), [
      [5, 0],
      [100, 0],
      [200, 0],
      [100, 0],
      [5, 0],
    ])
  })

  test('a detour out to a street and back, between two fixes, is cut across', () => {
    // The matcher took the path down to a street 35 m off and back up, where the fixes went straight
    // on: from the fix before, straight to the one on the way back up.
    const detour = [at(0, 0), at(50, 0), at(65, -35), at(80, 0), at(150, 0)]
    const walk = [at(10, 2), at(30, -3), at(50, 1), at(73, -12), at(95, 2), at(120, -1)]
    assert.deepEqual(snapAlong(walk, detour)!.map(metres), [
      [10, 0],
      [50, 0],
      [75, -13],
      [80, 0],
      [120, 0],
    ])
  })

  test('a leg nobody saw follows the line further than a detour would', () => {
    // The same line out to a street and back, but three minutes without a fix before the fix after it.
    const detour = [at(0, 0), at(50, 0), at(65, -35), at(80, 0), at(150, 0)]
    const timed = (point: Point, seconds: number): Point => ({ ...point, time: seconds * 1000 })
    const walk = [timed(at(10, 2), 0), timed(at(30, -3), 30), timed(at(50, 1), 60), timed(at(95, 2), 240), timed(at(120, -1), 270)]
    assert.deepEqual(snapAlong(walk, detour)!.map(metres), [
      [10, 0],
      [50, 0],
      [65, -35],
      [80, 0],
      [120, 0],
    ])
  })
})

describe('unseenLegs', () => {
  test('from a stay to the first fix, and between fixes minutes apart, drawn straight', () => {
    const home: Point = { ...at(0, -40), anchor: true }
    const fixes: Point[] = [
      { ...at(10, 2), time: 0 },
      { ...at(30, -3), time: 30_000 },
      { ...at(90, 5), time: 210_000 },
    ]
    assert.deepEqual(unseenLegs([home, ...fixes], [home, ...fixes]), [0, 2])
  })

  test('a stay that was snapped onto the line is no leg nobody saw', () => {
    const home: Point = { ...at(0, -5), anchor: true }
    const walk = [home, at(40, 3), at(80, -2), at(120, 4)]
    assert.deepEqual(unseenLegs(walk, snapAlong(walk, PATH)!), [])
  })

  test('a route fits up to 4 times as far plus 50 m', () => {
    assert.equal(routeFits(at(0, 0), at(100, 0), 440), true)
    assert.equal(routeFits(at(0, 0), at(100, 0), 460), false)
  })
})
