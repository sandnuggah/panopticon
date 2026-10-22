import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { LiveUpdate } from './live.ts'
import {
  extendTrails,
  historyMinutes,
  historyStart,
  MAX_HISTORY_MINUTES,
  nearestTrail,
  stayPoints,
  trailMinutes,
  trailStart,
  type TrailPoint,
} from './trail.ts'

describe('nearestTrail', () => {
  test('keeps offered lengths', () => {
    for (const length of [0, 60, 360, 1440, 'today'] as const) assert.equal(nearestTrail(length), length)
  })

  test('moves removed lengths to the closest one, never to off', () => {
    assert.equal(nearestTrail(5), 60)
    assert.equal(nearestTrail(30), 60)
    assert.equal(nearestTrail(180), 360)
  })

  test('ignores anything else', () => {
    for (const value of [undefined, null, -5, Number.NaN, '60', 'yesterday']) assert.equal(nearestTrail(value), undefined)
  })
})

describe('trailStart', () => {
  const now = new Date(2026, 8, 29, 14, 30).getTime()

  test('counts minutes back from now', () => {
    assert.equal(trailStart(60, now), now - 60 * 60 * 1000)
  })

  test('today starts at local midnight', () => {
    assert.equal(trailStart('today', now), new Date(2026, 8, 29).getTime())
  })

  test('off has no start', () => {
    assert.equal(trailStart(0, now), null)
  })
})

test('today loads a day of history', () => {
  assert.equal(trailMinutes('today'), 1440)
  assert.equal(trailMinutes(360), 360)
})

describe('history', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const minutes = (n: number) => n * 60_000

  test('a day and 3 hours before it, whatever the trail', () => {
    assert.deepEqual([0, 60, 360, 'today' as const].map(historyMinutes), [1620, 1620, 1620, 1620])
    assert.equal(historyMinutes('today'), MAX_HISTORY_MINUTES)
  })

  test('loaded from that long before the latest report, as a page open all along keeps it', () => {
    assert.equal(historyStart(240, now, now - minutes(2)), now - minutes(242))
    // Asleep for five hours: the stay it went quiet in.
    assert.equal(historyStart(240, now, now - minutes(300)), now - minutes(540))
  })

  test('quiet for over a day, never heard from, or reporting from the future: from now', () => {
    for (const last of [now - minutes(25 * 60), undefined]) assert.equal(historyStart(240, now, last), now - minutes(240))
    assert.equal(historyStart(240, now, now + minutes(10)), now - minutes(240))
  })

  test('live positions keep the same: that long before the newest', () => {
    const at = (time: number): TrailPoint => ({ lat: 59, lon: 18, time, valid: true })
    const update = (time: number): LiveUpdate => ({
      kind: 'position',
      id: 1,
      location: { lat: 59, lon: 18, fixTime: new Date(time).toISOString() },
      valid: true,
      placeIds: [],
    })
    // Reported 10 minutes ago, arriving now: kept back from when it was, not from now.
    const trails = { 1: [at(now - minutes(300)), at(now - minutes(245)), at(now - minutes(100))] }
    const next = extendTrails(trails, [update(now - minutes(10))], 240, now)
    assert.deepEqual(
      next[1]!.map((point) => (now - point.time) / 60_000),
      [245, 100, 10],
    )
    assert.equal(extendTrails(trails, [update(now - minutes(150))], 240, now), trails, 'older than the newest: ignored')
    // From the future (a tracker's clock ahead): kept back from now.
    assert.deepEqual(
      extendTrails(trails, [update(now + minutes(30))], 240, now)[1]!.map((point) => (now - point.time) / 60_000),
      [100, -30],
    )
  })

  test('live positions keep what the trail reads of them', () => {
    const update: LiveUpdate = {
      kind: 'position',
      id: 2,
      location: { lat: 59, lon: 18, fixTime: new Date(now).toISOString(), accuracy: 12 },
      valid: false,
      cell: 25_637_899,
      satellites: 0,
      placeIds: [],
    }
    assert.deepEqual(extendTrails({}, [update], 240, now)[2], [
      { lat: 59, lon: 18, time: now, valid: false, cell: 25_637_899, satellites: 0, accuracy: 12 },
    ])
  })

  test('"Here since" goes by 3 hours, or the trail if longer, before the newest point', () => {
    const points = Array.from({ length: 31 }, (_, hour) => ({ lat: 59, lon: 18, time: now - minutes(60 * (30 - hour)), valid: true }))
    const back = (length: 0 | 60 | 360 | 'today') => (now - stayPoints(points, length)[0]!.time) / 60_000
    assert.deepEqual([back(0), back(60), back(360), back('today')], [180, 180, 360, 1440])
    assert.equal(stayPoints(points.slice(-2), 360).length, 2)
  })
})
