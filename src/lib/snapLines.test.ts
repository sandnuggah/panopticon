import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_WALKS_PER_REQUEST, walkSignature, type MatchablePoint } from './matching.ts'
import type { SnappedPoint } from './snap.ts'
import { nextTry, snappedLines, toAsk, withAnswers, type AssetWalk, type SnapState } from './snapLines.ts'

// A walk east from home, a fix every 30 s, 40 m apart; positions in metres east of a start point.
const START = { lat: 59.31, lon: 18.07, time: Date.parse('2026-10-19T08:00:00Z') }
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const fix = (step: number): MatchablePoint => ({
  lat: START.lat,
  lon: START.lon + (step * 40) / METERS_PER_DEGREE_LON,
  time: START.time + step * 30_000,
})
const home: MatchablePoint = { ...fix(0), time: START.time - 1000, anchor: true }
/** The walk with its first `fixes` fixes, from home. */
const walk = (fixes: number, asset = 1): AssetWalk => {
  const points = [home, ...Array.from({ length: fixes }, (_, step) => fix(step))]
  return { asset, id: `walk-${START.time}`, signature: walkSignature(points), points }
}
/** Its line as the server would answer: each fix 2 m north of where it was, along the street. */
const line = (walk: AssetWalk): SnappedPoint[] =>
  walk.points.map((point) => ({ lat: point.lat + 2 / 110_540, lon: point.lon, time: point.time, how: 'matched' }))
const empty: SnapState = new Map()
const now = START.time + 3_600_000

describe('toAsk', () => {
  test('walks not yet answered as they are, a request’s worth', () => {
    const walks = Array.from({ length: MAX_WALKS_PER_REQUEST + 5 }, (_, asset) => walk(5, asset))
    assert.equal(toAsk(walks, empty, now).length, MAX_WALKS_PER_REQUEST)
    const answered = withAnswers(empty, [walk(5)], [line(walk(5))], now)
    assert.deepEqual(toAsk([walk(5)], answered, now), [])
    assert.deepEqual(toAsk([walk(6)], answered, now), [walk(6)], 'grown: asked again')
  })

  test('after a failure, not until it’s time to try again, later each time', () => {
    const failed = withAnswers(empty, [walk(5)], ['unavailable'], now)
    assert.deepEqual(toAsk([walk(5)], failed, now + 4_000), [])
    assert.equal(nextTry([walk(5)], failed), now + 5_000)
    assert.deepEqual(toAsk([walk(5)], failed, now + 5_000), [walk(5)])
    const again = withAnswers(failed, [walk(5)], ['unavailable'], now + 5_000)
    assert.equal(nextTry([walk(5)], again), now + 15_000, 'twice as long')
    assert.deepEqual(toAsk([walk(6)], again, now + 6_000), [walk(6)], 'a newer version is asked for at once')
    assert.equal(nextTry([walk(5)], withAnswers(again, [walk(5)], [line(walk(5))], now + 15_000)), null, 'answered')
  })
})

describe('snappedLines', () => {
  const first = walk(5)
  const answered = withAnswers(empty, [first], [line(first)], now)

  test('as answered for the walk as it is', () => {
    assert.deepEqual(snappedLines([first], answered), { 1: { [first.id]: { points: line(first), current: true } } })
  })

  test('grown: the line it had, up to the last fix both share, then the new fixes as recorded', () => {
    const grown = walk(7)
    const drawn = snappedLines([grown], answered)[1]![grown.id]!
    assert.equal(drawn.current, false)
    assert.deepEqual(drawn.points.slice(0, 6), line(first), 'the line as it was')
    assert.deepEqual(
      drawn.points.slice(6).map(({ time, how }) => ({ time, how })),
      [5, 6].map((step) => ({ time: fix(step).time, how: 'recorded' })),
    )
  })

  test('never as recorded again once it had a line, even when the longer version can’t be snapped', () => {
    const grown = walk(7)
    const unsnappable = withAnswers(answered, [grown], [null], now)
    assert.equal(snappedLines([grown], unsnappable)[1]![grown.id]!.points.length, 8)
    const failed = withAnswers(answered, [grown], ['unavailable'], now)
    assert.equal(snappedLines([grown], failed)[1]![grown.id]!.points.length, 8)
  })

  test('shorter now (its end became a stay): the line up to its new last fix', () => {
    const shorter = walk(3)
    const drawn = snappedLines([shorter], answered)[1]![shorter.id]!
    assert.deepEqual(drawn.points, line(first).slice(0, 4))
  })

  test('shorter now and asked for as it is: answered, and not asked for again', () => {
    const grown = walk(7)
    const shorter = walk(4)
    const later = withAnswers(withAnswers(answered, [grown], [line(grown)], now), [shorter], [line(shorter)], now)
    assert.deepEqual(snappedLines([shorter], later)[1]![shorter.id], { points: line(shorter), current: true })
    assert.deepEqual(toAsk([shorter], later, now), [])
  })

  test('a hop between two stays has no fixes: its line as it was, while its stays move', () => {
    const hop = (east: number): AssetWalk => {
      const points = [home, { ...fix(3), lon: fix(3).lon + east / METERS_PER_DEGREE_LON, anchor: true }]
      return { asset: 1, id: 'stays-1-2', signature: walkSignature(points), points }
    }
    const routed = withAnswers(empty, [hop(0)], [line(hop(0))], now)
    assert.deepEqual(snappedLines([hop(5)], routed)[1]!['stays-1-2'], { points: line(hop(0)), current: false })
  })

  test('a walk that starts a fix later now (the stay it left took that one in): the line it was, from its new first fix', () => {
    // The same fixes from the second on, under the id of its new first fix, not asked for yet.
    const points = [home, ...Array.from({ length: 6 }, (_, step) => fix(step + 1))]
    const later: AssetWalk = { asset: 1, id: `walk-${fix(1).time}`, signature: walkSignature(points), points }
    const drawn = snappedLines([later], answered)[1]![later.id]!
    assert.equal(drawn.current, false)
    assert.deepEqual(drawn.points.slice(0, 4), line(first).slice(2), 'from its new first fix, along the line it was')
    assert.deepEqual(
      drawn.points.slice(4).map(({ time, how }) => ({ time, how })),
      [
        { time: fix(5).time, how: 'recorded' },
        { time: fix(6).time, how: 'recorded' },
      ],
    )
  })

  test('a walk that starts later now and can’t be snapped as it is: still the line it was, even once the old one is forgotten', () => {
    const points = [home, ...Array.from({ length: 6 }, (_, step) => fix(step + 1))]
    const later: AssetWalk = { asset: 1, id: `walk-${fix(1).time}`, signature: walkSignature(points), points }
    const unsnappable = withAnswers(answered, [later], [null], now, [later])
    assert.equal(snappedLines([later], unsnappable)[1]![later.id]!.points.length, 6)
  })

  test('a walk that turns out to be pottering about between two stops: the hop between them has the walk’s line', () => {
    const points = [home, { ...fix(2), time: fix(2).time, anchor: true }]
    const hop: AssetWalk = { asset: 1, id: 'stays-a-b', signature: walkSignature(points), points }
    assert.deepEqual(snappedLines([hop], answered)[1]!['stays-a-b'], { points: line(first), current: false })
  })

  test('none: as recorded; and walks no longer on the map are forgotten', () => {
    assert.deepEqual(snappedLines([first], empty), {})
    const other = walk(5, 2)
    const both = withAnswers(answered, [other], [line(other)], now, [other])
    assert.deepEqual(Object.keys(snappedLines([first, other], both)), ['2'])
  })
})
