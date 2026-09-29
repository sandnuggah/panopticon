import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classifyTrail, currentActivity, currentStay, type TrailPiece } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// A made-up trip in the shape of real SinoTrack data: a report every 30 s, GPS lost underground,
// LTE cell IDs (site × 256 + antenna). Positions are metres east/north of a start point.

const START = { lat: 59.33, lon: 18.07, time: Date.parse('2026-09-26T08:00:00Z') }
const METERS_PER_DEGREE_LAT = 111_320
const METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * Math.cos((START.lat * Math.PI) / 180)

class Trip {
  points: TrailPoint[] = []
  private x = 0
  private y = 0
  private time = START.time
  private site = 1000

  private report(valid: boolean, cell = this.site * 256 + 1) {
    this.points.push({
      lat: START.lat + this.y / METERS_PER_DEGREE_LAT,
      lon: START.lon + this.x / METERS_PER_DEGREE_LON,
      time: this.time,
      valid,
      cell,
    })
  }

  /** Walks east at `kmh` (west if negative), one report per 30 s. */
  walk(minutes: number, kmh = 4) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.x += (kmh / 3.6) * 30
      this.report(true)
    }
    return this
  }

  /** Stays put, with GPS jitter of up to `jitter` metres. */
  stay(minutes: number, jitter = 8) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      const angle = i * 2.4
      this.points.push({
        lat: START.lat + (this.y + Math.sin(angle) * jitter) / METERS_PER_DEGREE_LAT,
        lon: START.lon + (this.x + Math.cos(angle) * jitter) / METERS_PER_DEGREE_LON,
        time: this.time,
        valid: true,
        cell: this.site * 256 + 1,
      })
    }
    return this
  }

  /** Rides north with GPS, one report per 30 s. */
  ride(meters: number, seconds = 60) {
    const steps = Math.max(1, Math.round(seconds / 30))
    for (let i = 0; i < steps; i++) {
      this.time += 30_000
      this.y += meters / steps
      this.site++
      this.report(true)
    }
    return this
  }

  /** Rides north underground: reports without a fix (stale position) past new masts, then a fix. */
  underground(meters: number, minutes: number) {
    for (let i = 0; i < minutes * 2 - 1; i++) {
      this.time += 30_000
      if (i % 2 === 0) this.site++
      this.report(false)
    }
    this.time += 30_000
    this.y += meters
    this.site++
    this.report(true)
    return this
  }

  /** Indoors: no fix for a while, switching between antennas on the same mast. */
  indoors(minutes: number) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.report(false, this.site * 256 + 1 + (i % 3))
    }
    return this
  }

  get now() {
    return this.time + 5_000
  }
}

const kinds = (pieces: TrailPiece[]) => pieces.map((piece) => piece.kind)

describe('classifyTrail', () => {
  test('a walk is one move', () => {
    assert.deepEqual(kinds(classifyTrail(new Trip().walk(10).points)), ['move'])
  })

  test('standing still with GPS jitter is one stay', () => {
    const pieces = classifyTrail(new Trip().stay(10, 15).points)
    assert.deepEqual(kinds(pieces), ['stay'])
    const stay = pieces[0] as Extract<TrailPiece, { kind: 'stay' }>
    assert.ok(stay.radius >= 10 && stay.radius <= 20, `radius ${stay.radius}`)
  })

  test('a fast hop between walks is a vehicle ride', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(1000, 60).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move'])
  })

  test('GPS jitter of 100 m in 30 s is not a ride', () => {
    const trip = new Trip().stay(5)
    trip.points.push({ ...trip.points.at(-1)!, lat: trip.points.at(-1)!.lat + 100 / METERS_PER_DEGREE_LAT, time: trip.points.at(-1)!.time + 30_000 })
    assert.ok(!kinds(classifyTrail(trip.points)).includes('vehicle'))
  })

  test('a GPS gap that ends far away is an underground ride', () => {
    const pieces = classifyTrail(new Trip().walk(5).underground(1800, 6).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'underground', 'move'])
  })

  test('a short, still stop between two rides is part of the ride (a station)', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(800, 30).stay(1.5).ride(800, 30).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move'])
  })

  test('a long stop between two rides is not (changing trains)', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(800, 30).stay(4).ride(800, 30).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'stay', 'vehicle', 'move'])
  })

  test('pottering about a yard is one stay', () => {
    const pieces = classifyTrail(new Trip().stay(10).walk(0.5, 5).stay(10).walk(0.5, 5).stay(10).walk(0.5, -5).stay(10).points)
    assert.deepEqual(kinds(pieces), ['stay'])
  })

  test('walking away and coming back is two stays and a walk', () => {
    const pieces = classifyTrail(new Trip().stay(10).walk(5).walk(5, -4).stay(10).points)
    assert.deepEqual(kinds(pieces), ['stay', 'move', 'stay'])
  })

  test('losing GPS indoors without going anywhere is not a ride', () => {
    const pieces = classifyTrail(new Trip().stay(5).indoors(10).stay(5).points)
    assert.ok(pieces.every((piece) => piece.kind === 'stay' || piece.kind === 'move'), kinds(pieces).join())
  })

  test('reports without a fix are never drawn as positions', () => {
    for (const piece of classifyTrail(new Trip().walk(5).underground(1800, 6).walk(5).points)) {
      if (piece.kind === 'move') assert.ok(piece.points.every((point) => point.valid))
      if (piece.kind === 'underground') assert.ok(piece.from.valid && piece.to.valid)
    }
  })
})

describe('currentActivity', () => {
  test('walking is no activity', () => {
    const trip = new Trip().walk(10)
    assert.equal(currentActivity(trip.points, trip.now), null)
  })

  test('riding with GPS is a vehicle', () => {
    const trip = new Trip().walk(5).ride(1000, 60)
    assert.equal(currentActivity(trip.points, trip.now), 'vehicle')
  })

  test('moving between masts without GPS is underground, before GPS comes back', () => {
    const trip = new Trip().walk(5)
    trip.underground(1800, 6)
    const beforeFix = trip.points.slice(0, -1)
    assert.equal(currentActivity(beforeFix, beforeFix.at(-1)!.time + 5_000), 'underground')
  })

  test('indoors on one mast is not underground', () => {
    const trip = new Trip().walk(5).indoors(5)
    assert.equal(currentActivity(trip.points, trip.now), null)
  })

  test('a station stop keeps the ride, a longer stop ends it', () => {
    const trip = new Trip().walk(5).ride(1000, 60).stay(1.5)
    assert.equal(currentActivity(trip.points, trip.now), 'vehicle')
    trip.stay(3)
    assert.equal(currentActivity(trip.points, trip.now), null)
  })

  test('old reports are no activity', () => {
    const trip = new Trip().walk(5).ride(1000, 60)
    assert.equal(currentActivity(trip.points, trip.now + 10 * 60_000), null)
  })
})

describe('currentStay', () => {
  test('staying after a walk is a stay since it began', () => {
    const trip = new Trip().walk(5)
    const arrived = trip.points.at(-1)!.time
    trip.stay(10)
    const stay = currentStay(trip.points, trip.now)
    assert.ok(stay?.began)
    assert.ok(Math.abs(stay.since - arrived) <= 30_000, `since ${stay.since - arrived} ms after arriving`)
  })

  test('a stay from the first point on may have begun earlier', () => {
    const trip = new Trip().stay(10)
    assert.equal(currentStay(trip.points, trip.now)?.began, false)
  })

  test('walking, riding or old reports are no stay', () => {
    const walking = new Trip().stay(10).walk(5)
    assert.equal(currentStay(walking.points, walking.now), null)
    const riding = new Trip().stay(10).ride(1000, 60)
    assert.equal(currentStay(riding.points, riding.now), null)
    const old = new Trip().walk(5).stay(10)
    assert.equal(currentStay(old.points, old.now + 10 * 60_000), null)
  })
})
