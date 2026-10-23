import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { outingsOf, walkLength } from './outings.ts'
import type { TrailPiece } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Positions in metres east of Home, times in minutes.
const START = { lat: 59.31, lon: 18.07, time: Date.parse('2026-10-20T06:00:00Z') }
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const at = (east: number, minute: number): TrailPoint => ({
  lat: START.lat,
  lon: START.lon + east / METERS_PER_DEGREE_LON,
  time: START.time + minute * 60_000,
  valid: true,
})
const home = (from: number, to: number): TrailPiece => ({
  kind: 'stay',
  center: at(0, from),
  radius: 10,
  from: at(0, from).time,
  to: at(0, to).time,
  atPlace: true,
})
const stop = (east: number, from: number, to: number): TrailPiece => ({
  kind: 'stay',
  center: at(east, from),
  radius: 10,
  from: at(east, from).time,
  to: at(east, to).time,
})
const walk = (...points: [number, number][]): TrailPiece => ({ kind: 'move', points: points.map(([east, minute]) => at(east, minute)) })

describe('outingsOf', () => {
  test('from leaving home to coming back, a trip to the pee spot too; one under way has no end', () => {
    const outings = outingsOf([
      home(0, 60),
      walk([0, 60], [150, 65], [300, 70], [150, 75], [0, 80]),
      home(80, 120),
      walk([0, 120], [80, 122], [0, 124]),
      home(124, 200),
      walk([0, 200], [200, 205]),
    ])
    assert.deepEqual(
      outings.map((outing) => [outing.from, outing.to]),
      [
        [at(0, 60).time, at(0, 80).time],
        [at(0, 120).time, at(0, 124).time],
        [at(0, 200).time, null],
      ],
    )
    assert.ok(Math.abs(outings[0]!.walked - 600) < 2, 'out and back')
    assert.ok(Math.abs(outings[0]!.furthest - 300) < 2)
  })

  test("fixes wandering about home aren't an outing", () => {
    assert.deepEqual(outingsOf([home(0, 60), walk([0, 60], [30, 61], [0, 62]), home(62, 120)]), [])
  })

  test('a short stop on the way is part of it; a long stay elsewhere ends it', () => {
    const shortStop = outingsOf([home(0, 10), walk([0, 10], [200, 15]), stop(200, 15, 22), walk([200, 22], [0, 27]), home(27, 60)])
    assert.equal(shortStop.length, 1)
    assert.equal(shortStop[0]!.walks.length, 2)
    const longStay = outingsOf([home(0, 10), walk([0, 10], [500, 20]), stop(500, 20, 50), walk([500, 50], [0, 60]), home(60, 90)])
    assert.equal(longStay.length, 2, "to a friend's and back")
  })

  test('a trail that begins out is an outing from its first point', () => {
    const outings = outingsOf([walk([300, 0], [150, 5], [0, 10]), home(10, 60)])
    assert.deepEqual(
      outings.map((outing) => [outing.from, outing.to]),
      [[at(300, 0).time, at(0, 10).time]],
    )
  })
})

describe('outingsOf, when the tracker goes quiet', () => {
  const minutes = (n: number) => at(0, n).time

  test("asleep at a friend's after 8 minutes of fixes: there since it arrived, not out ever since", () => {
    const outings = outingsOf([home(0, 60), walk([0, 60], [500, 70]), stop(500, 70, 78)], minutes(78 + 360))
    assert.deepEqual(
      outings.map((outing) => [outing.from, outing.to]),
      [[minutes(60), minutes(70)]],
    )
  })

  test('waking up there next morning and walking home: two outings, not one through the night', () => {
    const outings = outingsOf([home(0, 60), walk([0, 60], [500, 70]), stop(500, 70, 78), walk([500, 600], [0, 610]), home(610, 700)])
    assert.deepEqual(
      outings.map((outing) => [outing.from, outing.to]),
      [
        [minutes(60), minutes(70)],
        [minutes(600), minutes(610)],
      ],
    )
  })

  test('a tracker that died on a walk: the outing ends with its last report, even when it wakes up at home', () => {
    assert.deepEqual(
      outingsOf([home(0, 60), walk([0, 60], [300, 70])], minutes(200)).map((outing) => outing.to),
      [minutes(70)],
    )
    assert.deepEqual(
      outingsOf([home(0, 60), walk([0, 60], [300, 70]), home(300, 400)]).map((outing) => outing.to),
      [minutes(70)],
    )
  })

  test("began: left a base the pieces have; a trail that begins out didn't, for Stats' days", () => {
    assert.deepEqual(
      outingsOf([walk([300, 0], [0, 10]), home(10, 60), walk([0, 60], [300, 70])]).map((outing) => outing.began),
      [false, true],
    )
    // A night at a friend's (not a place): the walk home the next morning left from there.
    const night = outingsOf([home(0, 60), walk([0, 60], [500, 70]), stop(500, 70, 100), walk([500, 600], [0, 610]), home(610, 700)])
    assert.deepEqual(
      night.map((outing) => outing.began),
      [true, true],
    )
  })

  test('a ride to daycare is an outing, as far as it went, with no walking', () => {
    const ride: TrailPiece = {
      kind: 'vehicle',
      from: at(0, 60),
      to: at(5000, 80),
      legs: [{ kind: 'vehicle', points: [at(0, 60), at(2500, 70), at(5000, 80)] }],
    }
    const [outing] = outingsOf([home(0, 60), ride, { ...(stop(5000, 80, 200) as Extract<TrailPiece, { kind: 'stay' }>), atPlace: true }])
    assert.equal(outing!.rode, true)
    assert.equal(outing!.walked, 0)
    assert.ok(Math.abs(outing!.furthest - 5000) < 25, `furthest ${outing!.furthest}`)
  })
})

describe('walkLength', () => {
  test('along the fixes, without standing-still jitter', () => {
    assert.ok(Math.abs(walkLength([at(0, 0), at(5, 1), at(3, 2), at(100, 3)]) - 100) < 1)
  })
})
