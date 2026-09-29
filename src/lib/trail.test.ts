import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nearestTrail, trailMinutes, trailStart } from './trail.ts'

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
