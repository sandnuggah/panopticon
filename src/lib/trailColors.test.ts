import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DEFAULT_TRAIL_COLOR, TRAIL_COLORS, trailColorOf } from './trailColors.ts'

describe('trailColorOf', () => {
  test('a colour in its shade for a day or a night map', () => {
    const blue = TRAIL_COLORS.find((color) => color.id === 'blue')!
    assert.equal(trailColorOf('blue', false), blue.day)
    assert.equal(trailColorOf('blue', true), blue.night)
  })

  test("the default for one that isn't offered (any more)", () => {
    const green = TRAIL_COLORS.find((color) => color.id === DEFAULT_TRAIL_COLOR)!
    assert.equal(trailColorOf('teal', false), green.day)
    assert.equal(trailColorOf(undefined, true), green.night)
  })

  test('five to choose from, each its own', () => {
    assert.equal(TRAIL_COLORS.length, 5)
    assert.equal(new Set(TRAIL_COLORS.map((color) => color.id)).size, 5)
  })
})
