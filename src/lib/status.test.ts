import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { assetStatus, isGrey } from './status.ts'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const minutes = (n: number) => new Date(NOW - n * 60_000).toISOString()
/** An asset last fixed `fix` minutes ago and last heard from `contact` minutes ago. */
const asset = (fix: number, contact = fix) => ({
  location: { lat: 59.3, lon: 18.07, fixTime: minutes(fix) },
  lastUpdate: minutes(contact),
})
const home = { place: 1, since: NOW - 5 * 3_600_000, began: true }

describe('assetStatus', () => {
  test('asleep at home for most of a day is resting there, not lost', () => {
    const status = assetStatus(asset(19 * 60), { presence: home }, NOW)
    assert.deepEqual(status, { kind: 'resting', place: 1 })
    assert.equal(isGrey(status), false)
  })

  test('resting somewhere else, too; lost after a day without a word', () => {
    assert.deepEqual(assetStatus(asset(120), { stay: { since: NOW - 3 * 3_600_000, began: true } }, NOW), { kind: 'resting', place: null })
    const lost = assetStatus(asset(25 * 60), { presence: home }, NOW)
    assert.equal(lost.kind, 'lost')
    assert.equal(isGrey(lost), true)
  })

  test('out: moving while it reports, lost after 30 minutes of silence', () => {
    assert.deepEqual(assetStatus(asset(1), {}, NOW), { kind: 'moving' })
    assert.equal(assetStatus(asset(31), {}, NOW).kind, 'lost')
  })

  test('out, reporting without a fix for 5 minutes: no GPS, since the last fix; at a place, resting', () => {
    assert.deepEqual(assetStatus(asset(8, 0), {}, NOW), { kind: 'no-gps', since: Date.parse(minutes(8)) })
    assert.equal(assetStatus(asset(8, 0), { presence: home }, NOW).kind, 'resting')
  })

  test('riding is moving, whatever stay there was', () => {
    assert.deepEqual(assetStatus(asset(1), { activity: 'vehicle', stay: { since: NOW, began: true } }, NOW), { kind: 'moving' })
  })

  test('never located: unknown, and grey', () => {
    const status = assetStatus({ location: null, lastUpdate: null }, {}, NOW)
    assert.deepEqual(status, { kind: 'unknown' })
    assert.equal(isGrey(status), true)
  })
})
