import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addUp,
  averageWalk,
  byWeekday,
  dayStats,
  daysPerCharge,
  lastDays,
  NO_WALKS,
  periodDays,
  previousDays,
  records,
  streak,
  walkTimes,
  type DayStats,
} from './stats.ts'
import type { TrailPoint } from './trail.ts'

// Made-up days: a report every 30 s, positions in metres east/north of a start point.
const START = { lat: 59.33, lon: 18.07, time: Date.parse('2026-09-26T08:00:00Z') }
const METERS_PER_DEGREE_LAT = 111_320
const METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * Math.cos((START.lat * Math.PI) / 180)

class Day {
  points: TrailPoint[] = []
  private x = 0
  private time = START.time

  private report(jitter = 0) {
    this.points.push({
      lat: START.lat + jitter / METERS_PER_DEGREE_LAT,
      lon: START.lon + this.x / METERS_PER_DEGREE_LON,
      time: this.time,
      valid: true,
    })
  }

  /** Walks east (west if negative) at about 4 km/h. */
  walk(meters: number) {
    const steps = Math.round(Math.abs(meters) / 33)
    for (let i = 0; i < steps; i++) {
      this.time += 30_000
      this.x += meters / steps
      this.report()
    }
    return this
  }

  /** A ride east, fast: a report every 30 s. */
  ride(meters: number, seconds: number) {
    const steps = Math.max(1, Math.round(seconds / 30))
    for (let i = 0; i < steps; i++) {
      this.time += 30_000
      this.x += meters / steps
      this.report()
    }
    return this
  }

  /** Stands still for a while, with a little GPS jitter. */
  stay(minutes: number) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.report(i % 2 ? 4 : -4)
    }
    return this
  }
}

const day = (walked: number): DayStats => ({ ...NO_WALKS, walked })

describe('dayStats', () => {
  test('counts outings, as the card lists them: a stop on the way is part of one, a visit home ends it', () => {
    // Out to the park, ten minutes there, and back: one outing (it was two walks).
    assert.equal(dayStats(new Day().stay(30).walk(500).stay(10).walk(-500).stay(30).points, null).walks, 1)
    // Out and back, home for a minute, out and back again: two (it was one walk).
    const points = new Day().stay(30).walk(300).walk(-300).stay(1).walk(300).walk(-300).stay(30).points
    const home = (from: number, to: number) => ({
      from: points[from]!.time,
      to: points[to]!.time,
      center: { lat: START.lat, lon: START.lon },
    })
    const back = points.findIndex((point, index) => index > 60 && point.lon === START.lon)
    const visits = [home(0, 59), home(back, back + 2), home(points.length - 60, points.length - 1)]
    assert.equal(dayStats(points, null, undefined, visits).walks, 2)
  })

  test('an outing under way at midnight counts on the day it left, its walking on each day it walked', () => {
    // The day begins out, walking home: walked that day, but counted the day before.
    const points = new Day().walk(-500).stay(30).points
    const home = [
      { from: points.at(-60)!.time, to: points.at(-1)!.time, center: { lat: START.lat, lon: START.lon - 500 / METERS_PER_DEGREE_LON } },
    ]
    const stats = dayStats(points, null, undefined, home)
    assert.equal(stats.walks, 0)
    assert.ok(stats.walked > 400, `walked ${stats.walked}`)
  })

  test('with the hours around midnight: a stop across it seen whole, each outing on the day it left', () => {
    // Out to a friend's, 30 minutes there across midnight, and back: one outing each day.
    const points = new Day().stay(30).walk(500).stay(30).walk(-500).stay(30).points
    const there = points.filter((point) => Math.abs(point.lon - points[0]!.lon) * METERS_PER_DEGREE_LON > 480)
    const midnight = there[Math.floor(there.length / 2)]!.time
    const [before, after] = [
      { from: midnight - 86_400_000, to: midnight },
      { from: midnight, to: midnight + 86_400_000 },
    ]
    assert.equal(dayStats(points, null, undefined, [], before).walks, 1)
    assert.equal(dayStats(points, null, undefined, [], after).walks, 1)
    // Each day's half of the stop alone (15 minutes) is no base: the walk home was an outing under way.
    assert.equal(
      dayStats(
        points.filter((point) => point.time >= midnight),
        null,
      ).walks,
      0,
    )
  })

  test('a walk out and back from home: its length, time, how far it got', () => {
    const points = new Day().stay(30).walk(1000).walk(-1000).stay(30).points
    const stats = dayStats(points, { lat: START.lat, lon: START.lon })
    assert.equal(stats.walks, 1)
    // The stays at home take the first and last few tens of metres (within 40 m of their middle).
    assert.ok(stats.walked > 1900 && stats.walked <= 2000, `walked ${stats.walked}`)
    assert.equal(stats.longest, stats.walked)
    assert.ok(Math.abs(stats.walking - 30 * 60_000) < 120_000, `walking ${stats.walking}`)
    assert.ok(Math.abs(stats.furthest! - 1000) < 40, `furthest ${stats.furthest}`)
    assert.equal(stats.stops, 0)
  })

  test('a stop of a minute or two on a walk counts; standing at home is no walk', () => {
    const points = new Day().stay(30).walk(600).stay(1.5).walk(600).stay(30).points
    const stats = dayStats(points, null)
    assert.equal(stats.walks, 1)
    assert.equal(stats.stops, 1)
    assert.equal(stats.furthest, null)
    assert.deepEqual(dayStats(new Day().stay(120).points, null), { ...NO_WALKS, fixes: 240 })
  })

  test('pottering about the yard is no walk', () => {
    assert.equal(dayStats(new Day().stay(30).walk(50).walk(-50).stay(30).points, null).walks, 0)
  })
})

describe('addUp', () => {
  test('totals, with the longest walk and the furthest point of any day', () => {
    const total = addUp([
      { ...NO_WALKS, walked: 2000, walks: 2, longest: 1500, walking: 1, stops: 3, furthest: 800, fixes: 100, starts: [1, 2] },
      { ...NO_WALKS, walked: 1000, walks: 1, longest: 1000, walking: 2, stops: 1, fixes: 50, starts: [3], rides: 1, rode: 900 },
      { ...NO_WALKS, battery: { low: 40, high: 90 }, charges: [7] },
    ])
    assert.deepEqual(total, {
      walked: 3000,
      walks: 3,
      longest: 1500,
      walking: 3,
      stops: 4,
      furthest: 800,
      fixes: 150,
      starts: [1, 2, 3],
      rides: 1,
      underground: 0,
      rode: 900,
      battery: { low: 40, high: 90 },
      charges: [7],
    })
  })
})

describe('streak', () => {
  test('days in a row with a walk; today counts once walked', () => {
    assert.deepEqual(streak([day(800), day(0), day(600), day(900), day(700)]), { current: 3, longest: 3 })
    // Not walked yet today: the streak goes on until today is over.
    assert.deepEqual(streak([day(800), day(600), day(900), day(0)]), { current: 3, longest: 3 })
    assert.deepEqual(streak([day(800), day(0), day(0)]), { current: 0, longest: 1 })
    assert.deepEqual(streak([day(800), day(300), day(700)]), { current: 1, longest: 1 }, 'a short walk is no day')
  })
})

describe('days', () => {
  // Wednesday 14 October 2026, in the afternoon (local time).
  const now = new Date(2026, 9, 14, 15, 30).getTime()
  const dates = (days: { from: number }[]) => days.map((d) => new Date(d.from).getDate())

  test('today, this week from Monday, this month', () => {
    assert.deepEqual(dates(periodDays('today', now)), [14])
    assert.deepEqual(dates(periodDays('week', now)), [12, 13, 14])
    assert.equal(periodDays('month', now).length, 14)
    const [monday] = periodDays('week', now)
    assert.equal(monday!.to - monday!.from, 24 * 3600_000)
  })

  test('the same stretch of the period before', () => {
    assert.deepEqual(dates(previousDays('today', periodDays('today', now))), [13])
    assert.deepEqual(dates(previousDays('week', periodDays('week', now))), [5, 6, 7])
    const lastMonth = previousDays('month', periodDays('month', new Date(2026, 2, 31, 12).getTime()))
    assert.equal(lastMonth.length, 28, 'the 1st to the 31st of March against all of February')
  })

  test('the last days, ending today', () => {
    assert.deepEqual(dates(lastDays(3, now)), [12, 13, 14])
  })
})

describe('more stats', () => {
  test('a day knows when its walk left, and its battery: lowest, highest and a charge', () => {
    const walked = new Day().stay(30).walk(1000).walk(-1000).stay(30).points
    const stats = dayStats(walked, null, undefined, [], undefined, [
      { time: 0, percent: 30 },
      { time: 1, percent: 25 },
      { time: 2, percent: 60 },
      { time: 3, percent: 58 },
    ])
    assert.equal(stats.starts.length, 1)
    assert.ok(stats.starts[0]! > walked[0]!.time && stats.starts[0]! < walked.at(-1)!.time)
    assert.deepEqual(stats.battery, { low: 25, high: 60 })
    assert.deepEqual(stats.charges, [2], 'up 35 points from its lowest')
    // Charged from 10% to 100% over a couple of hours: one charge, then another once it's run down.
    const ramp = [10, 35, 60, 85, 100, 90, 60, 30, 12, 50, 95].map((percent, time) => ({ time, percent }))
    assert.deepEqual(dayStats([], null, undefined, [], undefined, ramp).charges, [1, 9])
  })

  test('a ride counts, with how far it went', () => {
    const stats = dayStats(new Day().stay(30).walk(300).ride(3000, 180).walk(300).stay(30).points, null)
    assert.equal(stats.rides, 1)
    assert.ok(Math.abs(stats.rode - 3000) < 200, `rode ${stats.rode}`)
    assert.equal(stats.underground, 0)
  })

  test('an average walk: how far, how long, how fast', () => {
    assert.deepEqual(averageWalk({ ...NO_WALKS, walks: 2, walked: 4000, walking: 3_600_000 }), { meters: 2000, ms: 1_800_000, kmh: 4 })
    assert.equal(averageWalk(NO_WALKS), null)
  })

  test('the hours walks usually leave: the busy ones, more than either side', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 9, 14, hour, minute).getTime()
    const { hours, usual } = walkTimes([at(7), at(7, 20), at(7, 40), at(8), at(12), at(12, 30), at(18), at(18, 10), at(23)])
    assert.equal(hours[7], 3)
    assert.deepEqual(usual, [7, 12, 18], 'one walk at 23 is no habit')
  })

  test('records, the days of the week, and how long a charge lasts', () => {
    const list = lastDays(3, new Date(2026, 9, 14, 15).getTime())
    const at = (index: number, hour: number) => list[index]!.from + hour * 3_600_000
    const days: DayStats[] = [
      { ...day(3000), walks: 1, longest: 3000, fixes: 10, starts: [at(0, 9)], charges: [at(0, 20)] },
      { ...day(5000), walks: 2, longest: 2600, fixes: 10, starts: [at(1, 6), at(1, 22)] },
      { ...day(0), charges: [at(2, 8)] },
    ]
    const best = records(days, list)
    assert.deepEqual(best.longest, { meters: 3000, day: list[0]!.from })
    assert.deepEqual(best.biggest, { meters: 5000, day: list[1]!.from })
    assert.equal(best.earliest, at(1, 6))
    assert.equal(best.latest, at(1, 22))
    // 12–14 October 2026: a Monday, Tuesday and Wednesday; the Wednesday had no fixes, so it isn't counted.
    assert.deepEqual(byWeekday(days, list).slice(0, 3), [
      { average: 3000, days: 1 },
      { average: 5000, days: 1 },
      { average: 0, days: 0 },
    ])
    assert.equal(daysPerCharge(days), 1.5, '20:00 to 08:00 two days on')
    assert.equal(daysPerCharge([days[0]!]), null)
  })
})
