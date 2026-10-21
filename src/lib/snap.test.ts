import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { drawWalk, routeFits, snapAlong, strayCandidates, type Point } from './snap.ts'

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

describe('drawWalk', () => {
  const home: Point = { ...at(0, -40), anchor: true }

  test('from a stay to the first fix, and between fixes minutes apart, are legs nobody saw', () => {
    const fixes: Point[] = [
      { ...at(10, 2), time: 0 },
      { ...at(30, -3), time: 30_000 },
      { ...at(90, 5), time: 210_000 },
    ]
    const walk = drawWalk([home, ...fixes], [])
    assert.equal(walk.snapped, false)
    assert.deepEqual(walk.unseen, [0, 2])
  })

  test('a leg nobody saw too short for a route is drawn straight', () => {
    const fixes: Point[] = [
      { ...at(10, 2), time: 0 },
      { ...at(15, 2), time: 300_000 },
    ]
    assert.deepEqual(drawWalk(fixes, []).unseen, [])
  })

  test('a fix or two that strayed from the line are left out, and the line goes on', () => {
    // The third fix jumped 30 m off, onto a street below: the walk goes on along the line.
    const walk = [at(10, 2), at(40, -3), at(70, 1), at(110, -30), at(140, 2), at(170, -1), at(199, 60)]
    assert.deepEqual(strayCandidates(walk, PATH), [[3]])
    assert.deepEqual(drawWalk(walk, PATH, new Set([3])).points.map(metres), [
      [10, 0],
      [100, 0],
      [200, 0],
      [200, 60],
    ])
  })

  test('between a stay and the line, a fix that strayed is left out too', () => {
    const walk = [home, at(60, -30), at(100, 3), at(140, -2), at(180, 1)]
    assert.deepEqual(strayCandidates(walk, PATH), [[1]])
    const drawn = drawWalk(walk, PATH, new Set([1]))
    assert.deepEqual(drawn.points.map(metres), [
      [0, -40],
      [100, 0],
      [180, 0],
    ])
    assert.deepEqual(drawn.unseen, [0], 'from the stay to the line: a route')
  })

  test('three fixes off the line in a row are no strays', () => {
    const walk = [at(0, 2), at(40, -3), at(80, 4), at(110, 60), at(150, 70), at(170, 65), at(198, 120), at(201, 160), at(199, 190)]
    assert.deepEqual(strayCandidates(walk, PATH), [])
  })

  test('in a park too, a fix may stray: off the line is more than 20 m off it, anywhere', () => {
    const walk = [at(10, 2), at(40, -12), at(70, -30), at(100, 12), at(130, -4)].map((point) => ({ ...point, park: true }))
    assert.deepEqual(strayCandidates(walk, PATH), [[2]])
  })

  test('a route fits up to 4 times as far plus 50 m', () => {
    assert.equal(routeFits(at(0, 0), at(100, 0), 440), true)
    assert.equal(routeFits(at(0, 0), at(100, 0), 460), false)
  })
})
