import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_POINTS_PER_WALK, matchableWalks, otherWalks, stayHopId, walkId } from './matching.ts'
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
    assert.equal(walks[0]!.id, walkId(move.points))
    assert.deepEqual(
      walks[0]!.points.map((point) => !!point.anchor),
      [true, false, false, false, true],
    )
  })

  test('the stays are timed as long before and after as the way takes at a walk, a minute at least', () => {
    // Home 20 m from the first fix (a minute), the next stay 140 m on from the last (100 s at 1.4 m/s).
    const move: TrailPiece = { kind: 'move', points: [fix(20, 0, 10), fix(60, 0, 11), fix(100, 0, 12)] }
    const points = matchableWalks([stay(0, 0, 10), move, stay(240, 20, 30)])[0]!.points
    assert.equal(points[0]!.time, move.points[0]!.time - 60_000)
    assert.ok(Math.abs(points.at(-1)!.time - (move.points.at(-1)!.time + 100_000)) < 1000)
  })

  test('a fix standing for 3 or more left out as jitter is where the dog stood', () => {
    // On, a stop of 4 fixes within a few metres (3 left out), on again; then 2 (1 left out); at the end
    // 4 again, but the last is kept as the end, so only 2 are left out.
    const move: TrailPiece = {
      kind: 'move',
      points: [
        fix(0, 0, 0),
        fix(40, 0, 1),
        fix(41, 2, 2),
        fix(39, 1, 3),
        fix(42, 0, 4),
        fix(80, 0, 5),
        fix(81, 1, 6),
        fix(120, 0, 7),
        fix(121, 1, 8),
        fix(122, 0, 9),
        fix(121, 2, 10),
      ],
    }
    assert.deepEqual(
      matchableWalks([move])[0]!.points.map((point) => !!point.stood),
      [false, true, false, false, false],
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
      walks.map((walk) => walk.id),
      [stayHopId(home, park)],
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

  test('a long hop to or from a weak fix is matched like any other: only a gap in time is unseen', () => {
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
      [false, false, false, false, false, false],
    )
  })

  test('a walk is the same walk as it grows; each version of it is told apart', () => {
    const points = Array.from({ length: 12 }, (_, step) => fix(step * 40, 0, step))
    const [shorter] = matchableWalks([{ kind: 'move', points: points.slice(0, 10) }])
    const [longer] = matchableWalks([{ kind: 'move', points }])
    assert.equal(longer!.id, shorter!.id)
    assert.notEqual(longer!.signature, shorter!.signature)
    const [inPark] = matchableWalks([{ kind: 'move', points }], (point) => point.lon > points[5]!.lon)
    assert.notEqual(inPark!.signature, longer!.signature, 'parks')
    const fromHome = (east: number) => matchableWalks([stay(east, -20, -1), { kind: 'move', points }])[0]!
    assert.notEqual(fromHome(0).signature, fromHome(-10).signature, 'where its stay is')
    assert.equal(matchableWalks([{ kind: 'move', points }])[0]!.signature, longer!.signature, 'the same')
  })

  test('a walk with too many points is thinned evenly, from its first to its last', () => {
    const points = Array.from({ length: 1000 }, (_, step) => fix(step * 20, 0, step))
    const [walk] = matchableWalks([stay(-30, -20, -1), { kind: 'move', points }, stay(20_010, 1001, 1020)])
    assert.equal(walk!.points.length, MAX_POINTS_PER_WALK)
    assert.equal(walk!.points[1]!.time, points[0]!.time)
    assert.equal(walk!.points.at(-2)!.time, points.at(-1)!.time)
    const gaps = walk!.points.slice(2, -1).map((point, index) => point.time - walk!.points[index + 1]!.time)
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 30_000, 'evenly')
  })
})

describe('gaps nobody saw', () => {
  test('between fixes as recorded: a dog standing still, its fixes left out as jitter, is no gap', () => {
    // Still for 3 minutes (fixes every 30 s within 2 m), then on: kept fixes 3.5 minutes apart.
    const still = [fix(0, 0, 0), ...[1, 2, 3, 4, 5, 6].map((step) => fix(1, 1, step)), fix(40, 0, 7), fix(80, 0, 8), fix(120, 0, 9)]
    const walk = matchableWalks([{ kind: 'move', points: still }])[0]!
    assert.equal(
      walk.points.some((point) => point.unseen),
      false,
    )
    // A real gap: nothing for 3 minutes.
    const gap = [fix(0, 0, 0), fix(40, 0, 7), fix(80, 0, 8), fix(120, 0, 9)]
    assert.deepEqual(
      matchableWalks([{ kind: 'move', points: gap }])[0]!.points.map((point) => !!point.unseen),
      [false, true, false, false],
    )
  })
})

describe('otherWalks', () => {
  test('the moves not worth snapping, by the id they had as walks, with their fixes', () => {
    const short: TrailPiece = { kind: 'move', points: [fix(0, 0, 10), fix(20, 5, 11), fix(10, 0, 12)] }
    const long: TrailPiece = { kind: 'move', points: [fix(0, 0, 30), fix(60, 0, 31), fix(120, 0, 32)] }
    const pieces = [stay(0, 0, 10), short, stay(0, 12, 30), long]
    const others = otherWalks(pieces, matchableWalks(pieces))
    assert.deepEqual(others, [
      { id: walkId(short.points), signature: '', points: short.points.map(({ lat, lon, time }) => ({ lat, lon, time })) },
    ])
  })
})
