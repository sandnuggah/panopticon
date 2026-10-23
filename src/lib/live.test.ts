import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Asset } from './asset'
import { applyUpdates } from './live.ts'

const betty: Asset = { id: 1, name: 'Betty', status: 'online', lastUpdate: null, location: null, placeIds: [], trailColor: 'blue' }
const device = { kind: 'device' as const, id: 1, name: 'Betty', status: 'online' as const, lastUpdate: null, disabled: false }

describe('applyUpdates', () => {
  test("a device update brings its trail colour, chosen somewhere else, or none: the default's", () => {
    assert.equal(applyUpdates([betty], [{ ...device, trailColor: 'orange' }]).assets[0]!.trailColor, 'orange')
    assert.equal(applyUpdates([betty], [device]).assets[0]!.trailColor, undefined)
  })

  test('a device update brings how its trail is drawn, chosen somewhere else, or nothing: the defaults', () => {
    const update = { ...device, trail: { length: 0 as const, pawPrints: true } }
    assert.deepEqual(applyUpdates([betty], [update]).assets[0]!.trail, { length: 0, pawPrints: true })
    assert.equal(applyUpdates([{ ...betty, trail: { pawPrints: true } }], [device]).assets[0]!.trail, undefined)
  })
})
