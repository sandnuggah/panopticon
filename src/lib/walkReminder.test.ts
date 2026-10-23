import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isAlertRule } from './alerts.ts'
import type { Place } from './places.ts'
import { DEFAULT_TRAIL_PROFILE } from './segments.ts'
import type { TrailPoint } from './trail.ts'
import {
  DEFAULT_WALK_RULE,
  hoursLabel,
  inQuietHours,
  parseWalkRule,
  walkReminderDue,
  walkReminderText,
  walkRule,
  walkState,
} from './walkReminder.ts'

// Made-up days at home and out: a report every 30 s, positions in metres east of Home.
const START = { lat: 59.33, lon: 18.07, time: Date.parse('2026-10-14T08:00:00Z') }
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((START.lat * Math.PI) / 180)
const HOME: Place = { id: 1, name: 'Home', area: { kind: 'circle', center: { lat: START.lat, lon: START.lon }, radius: 50 }, assetIds: [7] }

class Day {
  points: TrailPoint[] = []
  private x = 0
  time = START.time

  private report(jitter = 0) {
    this.points.push({ lat: START.lat + jitter / 111_320, lon: START.lon + this.x / METERS_PER_DEGREE_LON, time: this.time, valid: true })
  }

  walk(meters: number) {
    const steps = Math.round(Math.abs(meters) / 33)
    for (let i = 0; i < steps; i++) {
      this.time += 30_000
      this.x += meters / steps
      this.report()
    }
    return this
  }

  stay(minutes: number) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.report(i % 2 ? 4 : -4)
    }
    return this
  }
}

const rule = parseWalkRule(DEFAULT_WALK_RULE)!

describe('walk reminder rules', () => {
  test('after how long and quiet when, as a rule a phone keeps', () => {
    assert.deepEqual(rule, { minutes: 120, quietFrom: 22, quietUntil: 7 })
    assert.equal(walkRule({ minutes: 90, quietFrom: 23, quietUntil: 6 }), 'walk:90:23-6')
    assert.ok(isAlertRule('walk:90:23-6'))
    assert.ok(!isAlertRule('walk:45:22-7'), 'only the offered times')
    assert.ok(!isAlertRule('walk:120:24-7'))
    assert.equal(hoursLabel(90), '1½ hours')
    assert.equal(hoursLabel(60), '1 hour')
  })

  test('quiet hours across midnight, in the phone time zone', () => {
    const at = (iso: string) => Date.parse(iso)
    // 21:30 and 07:30 in Stockholm (UTC+2 in October) aren't quiet; 23:00 and 06:00 are.
    assert.equal(inQuietHours(at('2026-10-14T19:30:00Z'), rule, 'Europe/Stockholm'), false)
    assert.equal(inQuietHours(at('2026-10-14T21:00:00Z'), rule, 'Europe/Stockholm'), true)
    assert.equal(inQuietHours(at('2026-10-15T04:00:00Z'), rule, 'Europe/Stockholm'), true)
    assert.equal(inQuietHours(at('2026-10-15T05:30:00Z'), rule, 'Europe/Stockholm'), false)
    assert.equal(inQuietHours(at('2026-10-15T04:00:00Z'), { ...rule, quietFrom: 0, quietUntil: 0 }, 'Europe/Stockholm'), false, 'none')
  })
})

describe('walkState', () => {
  test('home after a walk: when it got back, how long and how far', () => {
    const day = new Day().stay(30).walk(800).walk(-800).stay(30)
    const state = walkState(day.points, [HOME], 7, DEFAULT_TRAIL_PROFILE, day.time)
    assert.equal(state.atHome, true)
    assert.ok(state.last, 'a walk')
    assert.ok(Math.abs(state.last.meters - 1600) < 200, `walked ${state.last.meters}`)
    assert.ok(state.last.end > START.time + 30 * 60_000 && state.last.end < day.time)
  })

  test('out on a walk is not at home', () => {
    const day = new Day().stay(30).walk(800)
    assert.equal(walkState(day.points, [HOME], 7, DEFAULT_TRAIL_PROFILE, day.time).atHome, false)
  })

  test('no walk in the points: none to go by', () => {
    const day = new Day().stay(120)
    assert.deepEqual(walkState(day.points, [HOME], 7, DEFAULT_TRAIL_PROFILE, day.time), { atHome: true, last: null })
  })
})

describe('walkReminderDue', () => {
  const since = Date.parse('2026-10-14T10:00:00Z')
  const due = (minutes: number, extra: Partial<Parameters<typeof walkReminderDue>[0]> = {}) =>
    walkReminderDue({
      atHome: true,
      since,
      now: since + minutes * 60_000,
      rule,
      timeZone: 'Europe/Stockholm',
      reminded: undefined,
      ...extra,
    })

  test('when the time is up, at home, once per wait', () => {
    assert.equal(due(119), false)
    assert.equal(due(121), true)
    assert.equal(due(121, { atHome: false }), false, 'out, or at another place')
    assert.equal(due(121, { reminded: since }), false, 'this wait was reminded of')
    assert.equal(due(121, { reminded: since - 3 * 3_600_000 }), true, 'an earlier wait was')
  })

  test('quiet hours wait: up at 22:30, reminded at 07:00', () => {
    const evening = Date.parse('2026-10-14T18:30:00Z') // 20:30 in Stockholm
    const at = (iso: string) =>
      walkReminderDue({ atHome: true, since: evening, now: Date.parse(iso), rule, timeZone: 'Europe/Stockholm', reminded: undefined })
    assert.equal(at('2026-10-14T20:30:00Z'), false, '22:30, quiet')
    assert.equal(at('2026-10-15T05:00:00Z'), true, '07:00')
  })
})

describe('walkReminderText', () => {
  const end = Date.parse('2026-10-14T12:02:00Z') // 14:02 in Stockholm
  const last = { end, ms: 35 * 60_000, meters: 1800 }

  test('for how long, and the last walk', () => {
    assert.deepEqual(walkReminderText('Kofi', last, end, end + 121 * 60_000, rule, 'Europe/Stockholm', 'en-GB'), {
      title: "Kofi hasn't been out for 2 hours",
      body: 'Last walk ended at 14:02 (35 min, 1.8 km)',
    })
  })

  test('since when, once quiet hours made it late; and with no walk to go by', () => {
    assert.equal(
      walkReminderText('Kofi', last, end, end + 10 * 3_600_000, rule, 'Europe/Stockholm', 'en-GB').title,
      "Kofi hasn't been out since 14:02",
    )
    assert.equal(walkReminderText('Kofi', null, end, end + 3 * 3_600_000, rule, 'Europe/Stockholm', 'en-GB').body, 'No walk since 14:02')
  })
})
