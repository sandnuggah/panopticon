import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TraccarPosition } from './traccar.server.ts'
import { adapterFor, readPosition } from './trackers.server.ts'

/** A position as Traccar stores it, made up. */
function position(
  protocol: string | null,
  fields: Partial<TraccarPosition> = {},
  attributes: Record<string, unknown> = {},
): TraccarPosition {
  return {
    deviceId: 30,
    protocol,
    valid: true,
    fixTime: '2026-10-21T12:00:00Z',
    latitude: 59.3577,
    longitude: 18.0912,
    accuracy: 0,
    cellId: null,
    cellNetwork: null,
    geofenceIds: [],
    attributes,
    ...fields,
  }
}

describe('tracker adapters', () => {
  test('picked by protocol: SinoTrack (h02), a phone (Traccar Client), the rest standard', () => {
    assert.equal(adapterFor('h02').kind, 'sinotrack')
    assert.equal(adapterFor('osmand').kind, 'phone')
    assert.equal(adapterFor('gt06').kind, 'standard')
    assert.equal(adapterFor(null).kind, 'standard')
  })

  test('SinoTrack: what h02 sends unnamed, as Traccar stores it (text)', () => {
    const st904l = position('h02', {}, { io1: '240', io2: '01', io4: '25637899', io5: '19', io6: '22', io7: '37', batteryLevel: 62 })
    assert.deepEqual(readPosition(st904l), {
      satellites: 19,
      cell: 25637899,
      network: { mcc: 240, mnc: 1 },
      csq: 22,
      battery: { percent: 62, volts: 3.7 },
    })
  })

  test('SinoTrack: no accuracy (it sends 0), and an unknown signal (99) or no cell is left out', () => {
    const reading = readPosition(position('h02', {}, { io4: '0', io5: '0', io6: '99' }))
    assert.deepEqual(reading, { satellites: 0 })
  })

  test("a phone: the fix's accuracy and the standard attributes", () => {
    const phone = position('osmand', { accuracy: 12.5 }, { batteryLevel: 80, sat: 9 })
    assert.deepEqual(readPosition(phone), { accuracy: 12.5, satellites: 9, battery: { percent: 80 } })
  })

  test("another tracker: Traccar's standard fields, and never another protocol's io values", () => {
    const other = position('gt06', { cellId: 4242, cellNetwork: { mcc: 240, mnc: 7 } }, { io5: '19', battery: 4.1 })
    assert.deepEqual(readPosition(other), { cell: 4242, network: { mcc: 240, mnc: 7 }, battery: { volts: 4.1 } })
  })
})
