import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { snapAlong, type Point } from './snap.ts'

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
})
