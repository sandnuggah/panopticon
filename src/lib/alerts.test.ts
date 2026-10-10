import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { alertBody, alertTitle, isAlertRule, ruleForEvent, rulesFor } from './alerts.ts'

describe('alerts', () => {
  test("Traccar's events and the rules they match", () => {
    assert.equal(ruleForEvent({ type: 'geofenceExit', geofenceId: 4 }), 'leave:4')
    assert.equal(ruleForEvent({ type: 'geofenceEnter', geofenceId: 4 }), 'arrive:4')
    assert.equal(ruleForEvent({ type: 'deviceOffline', geofenceId: 0 }), 'offline')
    assert.equal(ruleForEvent({ type: 'deviceUnknown', geofenceId: 0 }), 'offline')
    assert.equal(ruleForEvent({ type: 'geofenceExit', geofenceId: 0 }), null)
    assert.equal(ruleForEvent({ type: 'deviceMoving', geofenceId: 0 }), null)
  })

  test('rules are checked when they come from the browser', () => {
    assert.ok(isAlertRule('leave:4'))
    assert.ok(isAlertRule('offline'))
    assert.equal(isAlertRule('leave:0'), false)
    assert.equal(isAlertRule('leave:4;drop'), false)
    assert.equal(isAlertRule(4), false)
  })

  test('titles', () => {
    assert.equal(alertTitle('leave:4', 'Betty', 'Home'), 'Betty left Home')
    assert.equal(alertTitle('arrive:4', 'Betty', 'Daycare'), 'Betty arrived at Daycare')
    assert.equal(alertTitle('arrive:4', 'Betty', null), 'Betty arrived at a place')
    assert.equal(alertTitle('offline', 'Betty', null), "Betty's tracker went offline")
  })

  test("the time in the phone's own time zone", () => {
    assert.equal(alertBody('2026-10-10T12:02:00Z', 'Europe/Stockholm', 'sv-SE'), 'At 14:02')
    assert.equal(alertBody('2026-10-10T12:02:00Z', 'Not/AZone', 'en'), 'At 12:02 PM')
  })

  test('each place offers leaving and arriving, then offline', () => {
    assert.deepEqual(rulesFor([4, 7]), ['leave:4', 'arrive:4', 'leave:7', 'arrive:7', 'offline'])
  })
})
