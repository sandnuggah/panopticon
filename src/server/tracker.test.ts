import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TraccarDevice, TraccarPosition } from './traccar.server.ts'
import { toTrackerDetails } from './tracker.server.ts'

const device: TraccarDevice = {
  id: 30,
  name: 'Betty',
  uniqueId: '9171000030',
  status: 'online',
  lastUpdate: '2026-09-29T12:30:00.000Z',
  disabled: false,
  image: null,
  model: 'ST-904L',
}

/** An ST-904L report, as Traccar stores it: the extra values as text. */
function report(time: string, valid: boolean, extra: Record<string, unknown> = {}): TraccarPosition {
  return {
    deviceId: 30,
    protocol: 'h02',
    valid,
    fixTime: `2026-09-29T${time}Z`,
    latitude: 59.3577,
    longitude: 18.0912,
    accuracy: 0,
    cellId: null,
    cellNetwork: null,
    attributes: {
      io1: '240',
      io2: '01',
      io3: '1234',
      io4: '25637899',
      io5: '19',
      io6: '22',
      io7: '37',
      io8: '62',
      batteryLevel: 62,
      ...extra,
    },
  }
}

const history = ['12:27:30', '12:28:00', '12:28:30', '12:29:00', '12:29:30', '12:30:00'].map((time) => report(time, true))

describe('toTrackerDetails', () => {
  test('reads an ST-904L report', () => {
    const details = toTrackerDetails(device, history.at(-1), history)
    assert.equal(details.status, 'online')
    assert.equal(details.model, 'ST-904L')
    assert.equal(details.protocol, 'h02')
    assert.deepEqual(details.gps, { fix: true, satellites: 19 })
    assert.deepEqual(details.signal, { csq: 22, level: 'excellent', bars: 4 })
    assert.deepEqual(details.network, { mcc: 240, mnc: 1, country: 'Sweden', operator: 'Telia' })
    assert.deepEqual(details.battery, { percent: 62, volts: 3.7 })
    assert.equal(details.reportEverySeconds, 30)
    assert.deepEqual(details.position, { lat: 59.3577, lon: 18.0912 })
  })

  test('without a fix, says when the last one was', () => {
    const lost = [...history, report('12:30:30', false), report('12:31:00', false)]
    assert.deepEqual(toTrackerDetails(device, lost.at(-1), lost).gps, { fix: false, lastFix: '2026-09-29T12:30:00Z' })
    const none = [report('12:30:30', false)]
    assert.deepEqual(toTrackerDetails(device, none[0], none).gps, { fix: false, lastFix: null })
  })

  test('signal levels follow the modem scale, and 99 means unknown', () => {
    const level = (csq: string) => toTrackerDetails(device, report('12:30:00', true, { io6: csq }), []).signal?.level
    assert.equal(level('5'), 'poor')
    assert.equal(level('12'), 'fair')
    assert.equal(level('17'), 'good')
    assert.equal(level('31'), 'excellent')
    assert.equal(level('99'), undefined)
  })

  test('other protocols only get the standard attributes', () => {
    const other = { ...report('12:30:00', true, { sat: 7, battery: 4.1 }), protocol: 'osmand' }
    const details = toTrackerDetails(device, other, [])
    assert.deepEqual(details.gps, { fix: true, satellites: 7 })
    assert.equal(details.signal, undefined)
    assert.equal(details.network, undefined)
    assert.deepEqual(details.battery, { percent: 62, volts: 4.1 })
  })

  test('never includes the tracker ID', () => {
    assert.ok(!JSON.stringify(toTrackerDetails(device, history.at(-1), history)).includes(device.uniqueId))
  })

  test('a tracker that never reported has only its connection', () => {
    assert.deepEqual(toTrackerDetails({ ...device, model: null }, undefined, []), {
      status: 'online',
      lastContact: device.lastUpdate,
      gps: null,
    })
  })
})
