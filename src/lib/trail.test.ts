import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { LiveUpdate } from './live.ts'
import {
  extendTrails,
  historyMinutes,
  historyStart,
  keepEarlier,
  MAX_HISTORY_MINUTES,
  mergeHistory,
  nearestTrail,
  stayPoints,
  trailMinutes,
  trailStart,
  type TrailPoint,
} from './trail.ts'

describe('nearestTrail', () => {
  test('keeps offered lengths', () => {
    for (const length of [0, 'outing', 'today', 1440] as const) assert.equal(nearestTrail(length), length)
  })

  test('moves removed lengths to this outing (an hour or less) or 24 hours, never to off', () => {
    assert.equal(nearestTrail(5), 'outing')
    assert.equal(nearestTrail(60), 'outing')
    assert.equal(nearestTrail(360), 1440)
    assert.equal(nearestTrail(720), 1440)
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
    assert.equal(trailStart('outing', now), 'outing', 'each asset its own (see shownTrails)')
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

  test('the visit an asset is at stays, however long it goes on, up to a week', () => {
    const at = (time: number): TrailPoint => ({ lat: 59, lon: 18, time, valid: true })
    const update = (time: number): LiveUpdate => ({
      kind: 'position',
      id: 1,
      location: { lat: 59, lon: 18, fixTime: new Date(time).toISOString() },
      valid: true,
      placeIds: [],
    })
    const trails = { 1: [at(now - minutes(300)), at(now - minutes(245)), at(now - minutes(100))] }
    const kept = extendTrails(trails, [update(now - minutes(10))], 240, now, { 1: now - minutes(300) })
    assert.deepEqual(
      kept[1]!.map((point) => (now - point.time) / 60_000),
      [300, 245, 100, 10],
    )
    const week = extendTrails(trails, [update(now - minutes(10))], 240, now, { 1: now - minutes(30_000) })
    assert.equal(week[1]!.length, 4)
    const old = { 1: [at(now - minutes(11_000)), ...trails[1]] }
    assert.equal(extendTrails(old, [update(now - minutes(10))], 240, now, { 1: 0 })[1]![0]!.time, now - minutes(300), 'over a week')
  })

  test('more history fetched later goes in by time, each point once', () => {
    const at = (time: number): TrailPoint => ({ lat: 59, lon: 18, time, valid: true })
    const points = [at(10), at(30)]
    assert.deepEqual(
      mergeHistory(points, [at(20), at(30), at(5)]).map((point) => point.time),
      [5, 10, 20, 30],
    )
    assert.equal(mergeHistory(points, [at(10)]), points, 'nothing new')
  })

  test('a history loaded again keeps the points the page had of the visit it is at, from before it starts', () => {
    const at = (time: number): TrailPoint => ({ lat: 59, lon: 18, time, valid: true })
    const current = { 1: [at(5), at(10), at(20), at(30)], 2: [at(5), at(30)] }
    const history = { 1: [at(20), at(30), at(40)], 2: [at(30), at(40)] }
    const loaded = keepEarlier(history, current, { 1: 10 })
    assert.deepEqual(
      loaded[1]!.map((point) => point.time),
      [10, 20, 30, 40],
    )
    assert.equal(loaded[2], history[2], 'out: as loaded')
    // Away for longer than the history: what the page had stops before it starts.
    assert.equal(keepEarlier(history, { 1: [at(5), at(10)] }, { 1: 5 })[1], history[1])
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
