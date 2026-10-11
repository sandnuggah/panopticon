import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classifyTrail, currentActivity, currentStay, stayDots, type TrailPiece } from './segments.ts'
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

  /**
   * The tracker silent (asleep, or out of reach), turning up `meters` north: it wakes without a fix
   * for a minute, as the real one does, then reports a fix.
   */
  silent(minutes: number, meters: number) {
    this.time += minutes * 60_000 - 60_000
    this.report(false)
    this.time += 30_000
    this.report(false)
    this.time += 30_000
    this.y += meters
    this.report(true)
    return this
  }

  /** An extra report `seconds` after the last one, `meters` further north, as the tracker sometimes sends. */
  extra(seconds: number, meters: number) {
    this.time += seconds * 1000
    this.y += meters
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
    trip.points.push({
      ...trip.points.at(-1)!,
      lat: trip.points.at(-1)!.lat + 100 / METERS_PER_DEGREE_LAT,
      time: trip.points.at(-1)!.time + 30_000,
    })
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
    assert.ok(
      pieces.every((piece) => piece.kind === 'stay' || piece.kind === 'move'),
      kinds(pieces).join(),
    )
  })

  test('a ride with GPS goes through its fixes', () => {
    const ride = classifyTrail(new Trip().walk(5).ride(3000, 180).walk(5).points).find((piece) => piece.kind === 'vehicle')
    assert.ok(ride?.kind === 'vehicle')
    assert.deepEqual(
      ride.legs.map((leg) => [leg.kind, leg.points.length]),
      [['vehicle', 7]],
    )
  })

  test('a report seconds after another does not break a ride', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(2000, 60).extra(3, 140).ride(2000, 60).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move'])
  })

  test('slower driving between fast stretches is still the ride (traffic)', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(800, 60).walk(1, 15).ride(800, 60).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move'])
  })

  test('a ride takes in the slower driving as it sets off and arrives', () => {
    const trip = new Trip().walk(5)
    const setsOff = trip.points.at(-1)!.time
    trip.walk(1, 14).ride(1000, 60).walk(1, 14)
    const arrives = trip.points.at(-1)!.time
    const ride = classifyTrail(trip.walk(5).points).find((piece) => piece.kind === 'vehicle')
    assert.ok(ride?.kind === 'vehicle')
    assert.equal(ride.from.time, setsOff)
    assert.equal(ride.to.time, arrives)
  })

  test('a silent tracker that turns up far away fast is a ride, not underground', () => {
    const pieces = classifyTrail(new Trip().walk(5).silent(20, 30_000).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move'])
  })

  test('a silent night in one place is a stay', () => {
    assert.deepEqual(kinds(classifyTrail(new Trip().stay(5).silent(600, 20).stay(5).points)), ['stay'])
  })

  test('turning up nearby after a long silence draws nothing in between', () => {
    assert.deepEqual(kinds(classifyTrail(new Trip().stay(5).silent(600, 500).stay(5).points)), ['stay', 'stay'])
  })

  test('a train that ends in a tunnel is a vehicle ride, with the tunnel underground', () => {
    const pieces = classifyTrail(new Trip().walk(5).ride(8000, 300).underground(1000, 2).walk(5).points)
    const ride = pieces.find((piece) => piece.kind !== 'move' && piece.kind !== 'stay')
    assert.ok(ride && ride.kind === 'vehicle')
    assert.deepEqual(
      ride.legs.map((leg) => leg.kind),
      ['vehicle', 'underground'],
    )
  })

  test('reports without a fix are never drawn as positions', () => {
    for (const piece of classifyTrail(new Trip().walk(5).underground(1800, 6).walk(5).points)) {
      if (piece.kind === 'move') assert.ok(piece.points.every((point) => point.valid))
      if (piece.kind === 'underground') assert.ok(piece.legs.every((leg) => leg.points.every((point) => point.valid)))
    }
  })
})

describe('stayDots', () => {
  const stays = (points: TrailPoint[]) =>
    classifyTrail(points).filter((piece): piece is Extract<TrailPiece, { kind: 'stay' }> => piece.kind === 'stay')

  test('coming back to the same place later is one dot', () => {
    const visits = stays(new Trip().stay(10).walk(10).walk(10, -4).stay(20).points)
    assert.equal(visits.length, 2)
    const { dots, dotOf } = stayDots(visits)
    assert.equal(dots.length, 1)
    assert.deepEqual(dotOf, [0, 0])
    assert.equal(dots[0]!.to, visits[1]!.to, 'fades by the latest visit')
    assert.deepEqual(dots[0]!.center, visits[1]!.center, 'at the longest visit')
    assert.equal(dots[0]!.ms, visits[0]!.to - visits[0]!.from + visits[1]!.to - visits[1]!.from)
  })

  test('stays apart are separate dots', () => {
    const { dots, dotOf } = stayDots(stays(new Trip().stay(10).walk(10).stay(10).points))
    assert.equal(dots.length, 2)
    assert.deepEqual(dotOf, [0, 1])
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

  test('settling a little off from where the stay began is the same stay', () => {
    // Walking home along the street, then indoors, where the fixes wander: one, after 345 s, is
    // over 40 m from the stay's first fix but close to its middle. Seconds from that first fix,
    // metres north and east of it (the mock Traccar's arrival home, which used to lose its stay).
    const fixes = [
      [-115, 73, 87],
      [-110, 68, 89],
      [-105, 63, 92],
      [-100, 56, 93],
      [-95, 48, 93],
      [-90, 40, 91],
      [-85, 34, 92],
      [-80, 30, 95],
      [-75, 26, 97],
      [-70, 23, 91],
      [-65, 21, 83],
      [-60, 20, 76],
      [-55, 21, 72],
      [-50, 22, 68],
      [-45, 21, 64],
      [-40, 18, 57],
      [-35, 15, 49],
      [-30, 13, 42],
      [-25, 13, 37],
      [-20, 12, 32],
      [-15, 8, 24],
      [-10, 4, 15],
      [-5, 1, 7],
      [0, 0, 0],
      [5, 0, -5],
      [10, -1, -10],
      [15, -4, -17],
      [20, -10, -19],
      [25, -12, -15],
      [30, -17, -11],
      [35, -24, -8],
      [45, -32, -7],
      [105, -36, -15],
      [165, -37, -14],
      [225, -26, -1],
      [285, -27, -3],
      [345, -40, -14],
      [405, -38, -11],
    ]
    const points = fixes.map(([seconds, north, east]) => ({
      lat: START.lat + north! / METERS_PER_DEGREE_LAT,
      lon: START.lon + east! / METERS_PER_DEGREE_LON,
      time: START.time + seconds! * 1000,
      valid: true,
    }))
    const stay = currentStay(points, START.time + 410_000)
    assert.ok(stay, 'still staying')
    assert.ok(stay.since <= START.time, 'since arriving')
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
