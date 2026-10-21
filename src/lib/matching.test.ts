import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchableWalks, stayHopKey, walkKey } from './matching.ts'
import { DEFAULT_TRAIL_PROFILE } from './segments.ts'
import type { TrailPiece } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Positions in metres east/north of a start point, a fix every 30 s.
const START = { lat: 59.31, lon: 18.07, time: Date.parse('2026-10-19T08:00:00Z') }
const METERS_PER_DEGREE_LAT = 110_540
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const fix = (east: number, north: number, step: number): TrailPoint => ({
  lat: START.lat + north / METERS_PER_DEGREE_LAT,
  lon: START.lon + east / METERS_PER_DEGREE_LON,
  time: START.time + step * 30_000,
  valid: true,
})
const stay = (east: number, from: number, to: number): Extract<TrailPiece, { kind: 'stay' }> => ({
  kind: 'stay',
  center: fix(east, 0, 0),
  radius: 10,
  from: START.time + from * 30_000,
  to: START.time + to * 30_000,
})

describe('matchableWalks', () => {
  test('a short hop from a stay counts from the stay, with the stays as anchors', () => {
    // 60 m from the first fix, but 80 m from home to the next stay.
    const move: TrailPiece = { kind: 'move', points: [fix(20, 0, 10), fix(50, 5, 11), fix(80, 0, 12)] }
    const walks = matchableWalks([stay(0, 0, 10), move, stay(80, 12, 30)])
    assert.equal(walks.length, 1)
    assert.equal(walks[0]!.key, walkKey(move.points))
    assert.deepEqual(
      walks[0]!.points.map((point) => !!point.anchor),
      [true, false, false, false, true],
    )
  })

  test('wandering about without going anywhere is no walk', () => {
    const move: TrailPiece = { kind: 'move', points: [fix(0, 0, 0), fix(20, 5, 1), fix(40, 0, 2), fix(10, 5, 3)] }
    assert.deepEqual(matchableWalks([move]), [])
  })

  test('stays next to each other, apart, have the hop between them', () => {
    const [home, park, bench] = [stay(0, 0, 10), stay(80, 14, 30), stay(100, 32, 40)]
    const walks = matchableWalks([home, park, bench])
    assert.deepEqual(
      walks.map((walk) => walk.key),
      [stayHopKey(home, park)],
    )
    assert.ok(walks[0]!.points.every((point) => point.anchor))
  })

  test("a fix the tracker's gap after the one before is marked: nobody saw the way there", () => {
    // Steps of 30 s, then 3 minutes (6 steps) without a fix.
    const move: TrailPiece = { kind: 'move', points: [fix(0, 0, 0), fix(40, 0, 1), fix(80, 0, 2), fix(200, 0, 8), fix(240, 0, 9)] }
    const walks = matchableWalks([move])
    assert.deepEqual(
      walks[0]!.points.map((point) => !!point.unseen),
      [false, false, false, true, false],
    )
    const slower = { ...DEFAULT_TRAIL_PROFILE, gapMs: 10 * 60 * 1000 }
    assert.ok(
      matchableWalks([move], () => false, slower)[0]!.points.every((point) => !point.unseen),
      'not for a tracker that reports less often',
    )
  })

  test('a long hop to or from a weak fix is marked: either end may be tens of metres off', () => {
    const weak = (point: TrailPoint): TrailPoint => ({ ...point, satellites: 6 })
    const strong = (point: TrailPoint): TrailPoint => ({ ...point, satellites: 18 })
    // 30 s apart: 30 m strong, 80 m to a weak fix, 80 m between strong fixes, 40 m to a weak one.
    const move: TrailPiece = {
      kind: 'move',
      points: [
        strong(fix(0, 0, 0)),
        strong(fix(30, 0, 1)),
        weak(fix(110, 0, 2)),
        strong(fix(190, 0, 3)),
        strong(fix(270, 0, 4)),
        weak(fix(310, 0, 5)),
      ],
    }
    assert.deepEqual(
      matchableWalks([move])[0]!.points.map((point) => !!point.unseen),
      [false, false, true, true, false, false],
    )
  })
})
