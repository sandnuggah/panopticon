import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { laneOut } from './lanes.ts'
import type { TimedPoint } from './trailGeometry.ts'

// Positions in metres east and north of a start point, times in minutes.
const START = { lat: 59.31, lon: 18.07, time: Date.parse('2026-10-20T06:00:00Z') }
const METERS_PER_DEGREE_LAT = 110_540
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const at = (east: number, north: number, minute: number): TimedPoint => ({
  lat: START.lat + north / METERS_PER_DEGREE_LAT,
  lon: START.lon + east / METERS_PER_DEGREE_LON,
  time: START.time + minute * 60_000,
})
/** The lanes along a line, in order, without repeats. */
const lanesOf = (pieces: { data: string; lane: number }[], line: string) =>
  pieces.filter((piece) => piece.data === line).map((piece) => piece.lane)

describe('laneOut', () => {
  test('a line on its own stays on the street, in one piece', () => {
    const pieces = laneOut([{ points: [at(0, 0, 0), at(300, 0, 5)], data: 'a' }])
    assert.deepEqual(
      pieces.map((piece) => piece.lane),
      [0],
    )
  })

  test('two walks along the same street: the first on it, the later one a lane to the side it was on', () => {
    const pieces = laneOut([
      { points: [at(0, 0, 0), at(300, 0, 5)], data: 'morning' },
      { points: [at(0, 3, 60), at(300, 3, 65)], data: 'evening' },
    ])
    assert.deepEqual(lanesOf(pieces, 'morning'), [0])
    // 3 m north, going east: to its left.
    assert.deepEqual(lanesOf(pieces, 'evening'), [-1])
  })

  test('only where they run together: before and after, each on its own street', () => {
    // The evening walk comes down a side street, along the morning's for 200 m, and off again.
    const pieces = laneOut([
      { points: [at(0, 0, 0), at(400, 0, 5)], data: 'morning' },
      { points: [at(100, 200, 60), at(100, 2, 62), at(300, 2, 64), at(300, -200, 66)], data: 'evening' },
    ])
    assert.deepEqual(lanesOf(pieces, 'evening'), [0, -1, 0])
    const along = pieces.find((piece) => piece.data === 'evening' && piece.lane === -1)!
    assert.ok(along.points[0]!.lon > at(90, 0, 0).lon && along.points.at(-1)!.lon < at(310, 0, 0).lon, 'just the stretch along it')
  })

  test("a walk's way back is beside its way out, on the side of the street it was on", () => {
    // Out east, back west 4 m north of it: to the north, its own right.
    const back = laneOut([{ points: [at(0, 0, 0), at(300, 0, 5), at(300, 4, 6), at(0, 4, 11)], data: 'walk' }]).filter(
      (piece) => piece.lane !== 0,
    )
    assert.deepEqual(
      back.map((piece) => piece.lane),
      [1],
    )
  })

  test("a new walk never moves an older one's lane", () => {
    const morning = { points: [at(0, 0, 0), at(300, 0, 5)], data: 'morning' }
    const noon = { points: [at(0, 2, 30), at(300, 2, 35)], data: 'noon' }
    const evening = { points: [at(0, 4, 60), at(300, 4, 65)], data: 'evening' }
    const before = laneOut([morning, noon])
    const after = laneOut([morning, noon, evening])
    assert.deepEqual(lanesOf(after, 'morning'), lanesOf(before, 'morning'))
    assert.deepEqual(lanesOf(after, 'noon'), lanesOf(before, 'noon'))
    assert.deepEqual(lanesOf(after, 'evening'), [-2], 'north of both: the next lane out to the left')
  })

  test('a street crossing is no lane: only lines about parallel run together', () => {
    const pieces = laneOut([
      { points: [at(0, 0, 0), at(300, 0, 5)], data: 'east' },
      { points: [at(150, -150, 60), at(150, 150, 65)], data: 'north' },
    ])
    assert.deepEqual(lanesOf(pieces, 'north'), [0])
  })

  test('pieces join end to end', () => {
    const pieces = laneOut([
      { points: [at(0, 0, 0), at(400, 0, 5)], data: 'morning' },
      { points: [at(100, 200, 60), at(100, 2, 62), at(300, 2, 64), at(300, -200, 66)], data: 'evening' },
    ]).filter((piece) => piece.data === 'evening')
    pieces.slice(1).forEach((piece, index) => assert.deepEqual(piece.points[0], pieces[index]!.points.at(-1)))
  })
})
