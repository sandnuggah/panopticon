import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  classifyTrail,
  currentActivity,
  currentStay,
  DEFAULT_TRAIL_PROFILE,
  distance,
  isWeak,
  lastConfirmedFix,
  latestOutingStart,
  stayDots,
  type LatLon,
  type TrailPiece,
} from './segments.ts'
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
    // Four minutes: a stop too short to be one on the map, part of the walk between the rides.
    const pieces = classifyTrail(new Trip().walk(5).ride(800, 30).stay(4).ride(800, 30).walk(5).points)
    assert.deepEqual(kinds(pieces), ['move', 'vehicle', 'move', 'vehicle', 'move'])
  })

  test('wandering about a park shows the wandering: its stops, and the walking between them', () => {
    // Sniffing about one spot, a minute and a half's walk to another 55 m away, sniffing there.
    const points = new Trip().stay(10, 18).walk(1.5, 2.2).stay(10, 18).points
    assert.equal(kinds(classifyTrail(points)).filter((kind) => kind === 'stay').length, 2)
  })

  test('a short stop is part of the walk', () => {
    const points = new Trip().stay(30).walk(5).stay(3).walk(5).stay(30).points
    assert.deepEqual(kinds(classifyTrail(points)), ['stay', 'move', 'stay'])
  })

  test('a GPS blip in one place is no wandering', () => {
    const points = new Trip().stay(10).walk(0.5, 5).walk(0.5, -5).stay(10).points
    assert.deepEqual(kinds(classifyTrail(points)), ['stay'])
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
    assert.deepEqual(kinds(classifyTrail(new Trip().stay(10).silent(600, 500).stay(10).points)), ['stay', 'stay'])
  })

  test('a stop shorter than the map draws as one, before a long silence, is part of the walk to it', () => {
    // 4.5 minutes of fixes, then 10 hours asleep: the silence counts for nothing, as it says nothing of where.
    assert.deepEqual(kinds(classifyTrail(new Trip().stay(5).silent(600, 500).stay(5).points)), ['move', 'stay'])
    assert.deepEqual(kinds(classifyTrail(new Trip().stay(4.5).silent(600, 500).stay(4.5).points)), ['move', 'move'])
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

  test('a lone fix out to one side and straight back is left out (GPS jumping)', () => {
    const points = new Trip().walk(5).points
    const spike = points[5]!
    points[5] = { ...spike, lat: spike.lat - 70 / METERS_PER_DEGREE_LAT }
    const pieces = classifyTrail(points)
    assert.deepEqual(kinds(pieces), ['move'])
    const drawn = (pieces[0] as Extract<TrailPiece, { kind: 'move' }>).points
    assert.equal(drawn.length, points.length - 1)
    assert.ok(!drawn.includes(points[5]!))
  })

  test('a weak fix out and back is left out with its neighbours minutes apart, a good one only within 3', () => {
    // 3.5 minutes between the fixes either side, indoors without a fix; the middle one 95 m out.
    const at = (north: number, step: number, satellites: number): TrailPoint => ({
      lat: START.lat + north / METERS_PER_DEGREE_LAT,
      lon: START.lon,
      time: START.time + step * 30_000,
      valid: true,
      satellites,
    })
    const drawn = (points: TrailPoint[]) =>
      classifyTrail(points).some((piece) => piece.kind === 'move' && piece.points.includes(points[1]!))
    assert.equal(drawn([at(0, 0, 6), at(-95, 6, 6), at(5, 7, 6)]), false)
    assert.equal(drawn([at(0, 0, 18), at(-95, 6, 18), at(5, 7, 18)]), true)
  })

  test('turning a corner keeps the fix at the corner', () => {
    // 45 m between fixes, east and then north.
    const at = (east: number, north: number, step: number): TrailPoint => ({
      lat: START.lat + north / METERS_PER_DEGREE_LAT,
      lon: START.lon + east / METERS_PER_DEGREE_LON,
      time: START.time + step * 30_000,
      valid: true,
    })
    const points = [at(0, 0, 0), at(45, 0, 1), at(90, 0, 2), at(90, 45, 3), at(90, 90, 4)]
    const pieces = classifyTrail(points)
    assert.equal((pieces[0] as Extract<TrailPiece, { kind: 'move' }>).points.length, 5)
  })

  test('reports without a fix are never drawn as positions', () => {
    for (const piece of classifyTrail(new Trip().walk(5).underground(1800, 6).walk(5).points)) {
      if (piece.kind === 'move') assert.ok(piece.points.every((point) => point.valid))
      if (piece.kind === 'underground') assert.ok(piece.legs.every((leg) => leg.points.every((point) => point.valid)))
    }
  })
})

describe('latestOutingStart', () => {
  test('the latest outing starts when the last long stay ended', () => {
    // Home, a walk, home again, another walk with a short stop: the latest outing is the second walk.
    const trip = new Trip().stay(60).walk(10).stay(40).walk(8).stay(5).walk(8)
    const pieces = classifyTrail(trip.points)
    const secondHome = pieces.filter((piece) => piece.kind === 'stay')[1] as Extract<TrailPiece, { kind: 'stay' }>
    assert.equal(latestOutingStart(pieces), secondHome.to)
  })

  test('back home for a long while: the outing that ended there is the latest', () => {
    const trip = new Trip().stay(60).walk(10).stay(40).walk(8).stay(45)
    const pieces = classifyTrail(trip.points)
    const stays = pieces.filter((piece): piece is Extract<TrailPiece, { kind: 'stay' }> => piece.kind === 'stay')
    assert.equal(latestOutingStart(pieces), stays[1]!.to)
  })

  test('no long stay: it is all one outing', () => {
    assert.equal(latestOutingStart(classifyTrail(new Trip().walk(10).stay(5).walk(10).points)), null)
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

describe('places', () => {
  const at = (east: number, north = 0): LatLon => ({
    lat: START.lat + north / METERS_PER_DEGREE_LAT,
    lon: START.lon + east / METERS_PER_DEGREE_LON,
  })
  const stays = (pieces: TrailPiece[]) => pieces.filter((piece): piece is Extract<TrailPiece, { kind: 'stay' }> => piece.kind === 'stay')
  /** A visit (see presence.ts) from the point at `from` to the one at `to` (null: still there), its dot at `center`. */
  const visit = (points: TrailPoint[], from: number, to: number | null, center: LatLon) => ({
    from: points[from]!.time,
    to: to === null ? null : points[to]!.time,
    center,
  })

  test("a visit to a place is one stay of all its points, however they wander, at the place's dot", () => {
    // Indoors the fixes settle in two spots 50 m apart, as at Kofi's home, with hops between them.
    const points = new Trip().stay(20).walk(0.5, 6).stay(15).walk(0.5, -6).stay(20).points
    assert.deepEqual(kinds(classifyTrail(points)), ['stay', 'move', 'stay', 'move', 'stay'])
    const after = classifyTrail(points, { visits: [visit(points, 0, null, at(25))] })
    assert.deepEqual(kinds(after), ['stay'])
    assert.deepEqual(stays(after)[0]!.center, at(25))
    assert.equal(stays(after)[0]!.atPlace, true)
    assert.equal(stays(after)[0]!.from, points[0]!.time)
    assert.equal(stays(after)[0]!.to, points.at(-1)!.time)
  })

  test('a walk out begins with the fix it left on, from the dot', () => {
    // 20 minutes at home (40 fixes), out from the 41st.
    const points = new Trip().stay(20).walk(10).stay(10).points
    const pieces = classifyTrail(points, { visits: [visit(points, 0, 40, at(0))] })
    assert.deepEqual(kinds(pieces), ['stay', 'move', 'stay'])
    assert.equal(stays(pieces)[0]!.to, points[39]!.time)
    const move = pieces[1] as Extract<TrailPiece, { kind: 'move' }>
    assert.deepEqual([move.points[0], move.points[1]], [points[39], points[40]], 'from the last fix there')
    assert.equal(stays(pieces)[1]!.atPlace, undefined)
  })

  test('a trip out it never left by (presence still there) is part of the visit; one it did is a walk', () => {
    const points = new Trip().stay(20).walk(1, 6).walk(1, -6).stay(20).points
    assert.deepEqual(kinds(classifyTrail(points, { visits: [visit(points, 0, null, at(0))] })), ['stay'])
    const out = classifyTrail(points, { visits: [visit(points, 0, 40, at(0)), visit(points, 44, null, at(0))] })
    assert.deepEqual(kinds(out), ['stay', 'move', 'stay'])
  })

  test('a night at a place is one stay, though the tracker wakes up 50 m off where it slept', () => {
    const points = new Trip().stay(10).silent(600, 50).stay(10).points
    assert.deepEqual(kinds(classifyTrail(points)), ['stay', 'stay'])
    assert.deepEqual(kinds(classifyTrail(points, { visits: [visit(points, 0, null, at(0))] })), ['stay'])
  })

  test('a night at a place, waking up to leave it: there until it left, and the walk out from then', () => {
    const points = new Trip().stay(10).silent(600, 120).walk(5).points
    // The first fix after the night (after two reports without one).
    const left = points.findIndex((point, index) => point.valid && index > 0 && point.time - points[0]!.time > 3_600_000)
    const pieces = classifyTrail(points, { visits: [visit(points, 0, left, at(0))] })
    assert.deepEqual(kinds(pieces), ['stay', 'move'])
    assert.equal(stays(pieces)[0]!.to, points[left]!.time)
    assert.equal((pieces[1] as Extract<TrailPiece, { kind: 'move' }>).points[0], points[left])
  })

  test('driven off from a place with no fix on the way: a ride, not a walk', () => {
    // 10 minutes at home, then 3 km off 5 minutes later, then walking there.
    const points = new Trip().stay(10).silent(5, 3000).walk(5).points
    const out = points.findIndex((point) => point.valid && distance(points[0]!, point) > 2000)
    const pieces = classifyTrail(points, { visits: [visit(points, 0, out, at(0))] })
    assert.notDeepEqual(kinds(pieces).slice(0, 2), ['stay', 'move'])
  })

  test('a stop at a place is a stop there, however short', () => {
    // Walks east for 10 minutes (about 670 m), then 3 minutes at home: the walk ends at its dot.
    const points = new Trip().walk(10).stay(3).points
    assert.deepEqual(kinds(classifyTrail(points)), ['move'])
    assert.deepEqual(kinds(classifyTrail(points, { visits: [visit(points, 20, null, at(670))] })), ['move', 'stay'])
  })

  test('a stop next to a visit, across a blip, is a stop of its own: presence had it out', () => {
    // Home, a fix 60 m out, then 10 minutes 30 m out.
    const points = new Trip().stay(20).walk(0.5, 7.2).walk(0.5, -3.6).stay(10).points
    assert.deepEqual(kinds(classifyTrail(points)), ['stay'], 'one spot, across the blip')
    const pieces = classifyTrail(points, { visits: [visit(points, 0, 40, at(0))] })
    assert.deepEqual(kinds(pieces), ['stay', 'move', 'stay'])
    assert.deepEqual(
      stays(pieces).map((stay) => stay.atPlace),
      [true, undefined],
    )
  })

  test("a place's dot takes in a longer stay nearby", () => {
    const hour = 60 * 60 * 1000
    const { dots, dotOf } = stayDots([
      { center: at(0), from: 0, to: hour / 6, atPlace: true },
      { center: at(30), from: hour, to: 2 * hour },
    ])
    assert.equal(dots.length, 1)
    assert.deepEqual(dotOf, [0, 0])
    assert.deepEqual(dots[0]!.center, at(0))
  })
})

describe('isWeak', () => {
  const at = { lat: START.lat, lon: START.lon, time: START.time, valid: true }

  test('an ST-904L fix with fewer than 10 satellites', () => {
    assert.equal(isWeak({ ...at, satellites: 9 }, DEFAULT_TRAIL_PROFILE), true)
    assert.equal(isWeak({ ...at, satellites: 10 }, DEFAULT_TRAIL_PROFILE), false)
    assert.equal(isWeak(at, DEFAULT_TRAIL_PROFILE), false, 'nothing said: not weak')
  })

  test('by accuracy, for a tracker that says how far off its fixes may be', () => {
    const byAccuracy = { ...DEFAULT_TRAIL_PROFILE, weakSatellites: undefined, weakAccuracyMeters: 50 }
    assert.equal(isWeak({ ...at, accuracy: 65 }, byAccuracy), true)
    assert.equal(isWeak({ ...at, accuracy: 12, satellites: 4 }, byAccuracy), false)
  })
})

describe('unconfirmed fixes', () => {
  // Metres north of the start, at a step of 30 s, with so many satellites.
  const at = (north: number, step: number, satellites: number): TrailPoint => ({
    lat: START.lat + north / METERS_PER_DEGREE_LAT,
    lon: START.lon,
    time: START.time + step * 30_000,
    valid: true,
    satellites,
  })
  const home = [at(0, 0, 18), at(3, 1, 18), at(-2, 2, 18), at(1, 3, 18), at(0, 4, 18)]
  /** Whether the trail goes anywhere over 100 m from home: a move through such a fix, or a stay there. */
  const away = (points: TrailPoint[]) =>
    classifyTrail(points).some((piece) =>
      piece.kind === 'move'
        ? piece.points.some((point) => distance(home[0]!, point) > 100)
        : piece.kind === 'stay' && distance(home[0]!, piece.center) > 100,
    )

  test('weak fixes far off after a gap, back home without a good fix: left out, and not where the asset is', () => {
    // 3 minutes without a fix, then 320 m away with 4–7 satellites, then home again after a long sleep.
    const canal = [at(-320, 10, 7), at(-330, 11, 4), at(-330, 12, 4)]
    const points = [...home, ...canal, at(5, 400, 6)]
    assert.equal(away(points), false)
    assert.equal(lastConfirmedFix([...home, ...canal]), home.at(-1), 'not confirmed yet: where it last was')
  })

  test('one fix left besides them: a stay there, not among them', () => {
    const pieces = classifyTrail([home[0]!, at(-320, 10, 7), at(-330, 11, 4), at(-330, 12, 4)])
    assert.deepEqual(kinds(pieces), ['stay'])
    assert.ok(distance(home[0]!, (pieces[0] as Extract<TrailPiece, { kind: 'stay' }>).center) < 1)
  })

  test('so does a run of them: four or more, over a minute and a half, at three positions or more', () => {
    // After a night asleep, 5–7 satellites, 120–150 m off (as at Kofi's on 21/10 at 7:28).
    const morning = [at(150, 900, 6), at(140, 901, 7), at(130, 902, 7), at(125, 903, 6)]
    assert.equal(lastConfirmedFix([...home, ...morning]), morning[3])
    assert.equal(away([...home, ...morning]), true)
    assert.equal(lastConfirmedFix([...home, ...morning.slice(0, 3)]), home.at(-1), 'three')
    const stuck = [at(-320, 10, 7), ...[11, 12, 13, 14, 15].map((step) => at(-330, step, 4))]
    assert.equal(lastConfirmedFix([...home, ...stuck]), home.at(-1), 'the canal: stuck on one position')
    const drifting = [at(-320, 10, 7), ...[11, 12, 13, 14, 15].map((step, k) => at(-330 + (k % 2) * 3, step, 4))]
    assert.equal(lastConfirmedFix([...home, ...drifting]), home.at(-1), 'drifting 3 m')
    // Stuck before a night asleep, then waking up 100 m off: not a run.
    assert.equal(lastConfirmedFix([...home, ...stuck, at(-230, 600, 6)]), home.at(-1), 'over a night')
  })

  test('a good fix near them confirms them', () => {
    const arriving = [at(150, 10, 6), at(155, 11, 12)]
    assert.equal(lastConfirmedFix([...home, ...arriving]), arriving[1])
    assert.equal(away([...home, ...arriving]), true)
  })

  test('good fixes after a gap, or weak ones close by, are never in doubt', () => {
    assert.equal(lastConfirmedFix([...home, at(-320, 10, 14)])?.satellites, 14)
    const near = at(60, 10, 5)
    assert.equal(lastConfirmedFix([...home, near]), near)
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
    const awake = { ...DEFAULT_TRAIL_PROFILE, quietMs: undefined }
    assert.equal(currentStay(old.points, old.now + 10 * 60_000, awake), null)
  })

  test('a tracker that sleeps when still keeps its stay through the silence, for up to a day', () => {
    const asleep = new Trip().walk(5).stay(10)
    const since = currentStay(asleep.points, asleep.now)!.since
    assert.equal(currentStay(asleep.points, asleep.now + 5 * 60 * 60_000)?.since, since)
    assert.equal(currentStay(asleep.points, asleep.now + 25 * 60 * 60_000), null)
    // Gone quiet on the move (out of reach, a flat battery): no stay.
    const moving = new Trip().stay(10).walk(5)
    assert.equal(currentStay(moving.points, moving.now + 60 * 60_000), null)
  })

  test('it holds until the asset has clearly left: two fixes over 50 m outside the stay', () => {
    // Sniffing about: one fix 60 m off, then nearby again.
    const sniffing = new Trip().stay(10).extra(30, 60)
    const since = currentStay(new Trip().stay(10).points, sniffing.now)!.since
    assert.equal(currentStay(sniffing.points, sniffing.now)?.since, since)
    // Walking away, a fix every 30 s, 33 m apart: it holds while near, then clears.
    const leaving = new Trip().stay(10).walk(1)
    assert.equal(currentStay(leaving.points, leaving.now)?.since, since, 'not clearly away yet')
    const gone = new Trip().stay(10).walk(4)
    assert.equal(currentStay(gone.points, gone.now), null)
  })

  test('a stop shorter than the map draws as one is no stay yet', () => {
    const sniffing = new Trip().walk(5).stay(3)
    assert.equal(currentStay(sniffing.points, sniffing.now), null)
    const stopped = new Trip().walk(5).stay(6)
    assert.ok(currentStay(stopped.points, stopped.now))
  })
})
