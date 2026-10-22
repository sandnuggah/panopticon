import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { walkKey } from './matching.ts'
import type { Place } from './places.ts'
import type { TrailPiece } from './segments.ts'
import type { TrailPoint } from './trail.ts'
import { alongPaths, drawTrail, firstShown, toTrailFeatures, trailFrom, trailView, type TrailView } from './trailGeometry.ts'

// A made-up day in the shape of an ST-904L's: a fix every 30 s with good satellites, positions in
// metres east and north of a start point.

const START = { lat: 59.33, lon: 18.07, time: Date.parse('2026-10-20T06:00:00Z') }
const METERS_PER_DEGREE_LAT = 111_320
const METERS_PER_DEGREE_LON = METERS_PER_DEGREE_LAT * Math.cos((START.lat * Math.PI) / 180)

class Trip {
  points: TrailPoint[] = []
  private x = 0
  private time = START.time

  private fix(jitter = 0) {
    this.points.push({
      lat: START.lat + jitter / METERS_PER_DEGREE_LAT,
      lon: START.lon + (this.x + jitter) / METERS_PER_DEGREE_LON,
      time: this.time,
      valid: true,
      satellites: 14,
    })
  }

  /** Stays put for `minutes`, with a few metres of jitter. */
  stay(minutes: number) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.fix(((i % 3) - 1) * 4)
    }
    return this
  }

  /** Walks east (west if `kmh` is negative) for `minutes`. */
  walk(minutes: number, kmh = 4) {
    for (let i = 0; i < minutes * 2; i++) {
      this.time += 30_000
      this.x += (kmh / 3.6) * 30
      this.fix()
    }
    return this
  }

  /** `minutes` from the start. */
  at(minutes: number) {
    return START.time + minutes * 60_000
  }
}

const view = (trip: Trip) => trailView(trip.points, [], 1, 'sinotrack')!
const shownFrom = (trail: TrailView, from: number) => trailFrom(trail, firstShown(trail.pieces, from))
const kinds = (pieces: TrailPiece[]) => pieces.map((piece) => piece.kind)

describe('trailFrom', () => {
  // Home for half an hour, a 20-minute walk, a 10-minute stop.
  const trip = new Trip().stay(30).walk(20).stay(10)
  const trail = view(trip)

  test('a walk under way when the trail starts is drawn whole, from the stay it set off from', () => {
    const shown = shownFrom(trail, trip.at(40))!
    assert.deepEqual(kinds(shown.pieces), ['stay', 'move', 'stay'])
    assert.equal(shown.pieces[1], trail.pieces[1])
  })

  test('pieces that ended before the trail starts are left out; with none left, there is no trail', () => {
    assert.deepEqual(kinds(shownFrom(trail, trip.at(55))!.pieces), ['stay'])
    assert.equal(shownFrom(trail, trip.at(61)), null)
  })

  test('a stay under way when the trail starts is drawn without what came before it', () => {
    const shown = shownFrom(trail, trip.at(10))!
    assert.equal(shown, trail, 'all of it')
    const long = new Trip().stay(30).walk(20).stay(40)
    assert.deepEqual(kinds(shownFrom(view(long), long.at(60))!.pieces), ['stay'])
  })

  test('as the trail starts later and later, only whole pieces drop off its old end', () => {
    let first = 0
    for (let minute = 0; minute <= 60; minute++) {
      const shown = shownFrom(trail, trip.at(minute))
      if (!shown) continue
      const index = trail.pieces.indexOf(shown.pieces[0]!)
      assert.ok(index >= first, `at ${minute} min`)
      assert.deepEqual(shown.pieces, trail.pieces.slice(index))
      first = index
    }
  })

  test('the latest outing is the whole trail’s, and the trail fades from its first piece drawn', () => {
    // Out and back home, then out again: the latest outing began when the second stay at home ended.
    const twice = new Trip().stay(30).walk(10).walk(10, -4).stay(25).walk(10)
    const whole = view(twice)
    const shown = shownFrom(whole, twice.at(70))!
    assert.equal(shown.outing, whole.outing)
    assert.equal(shown.oldest, (shown.pieces[0] as Extract<TrailPiece, { kind: 'stay' }>).from)
  })
})

describe('drawTrail', () => {
  const trip = new Trip().stay(10).walk(10).stay(10)
  const trail = view(trip)
  const move = trail.pieces[1] as Extract<TrailPiece, { kind: 'move' }>

  test('a walk runs from the dot of the stay it left to the dot of the next', () => {
    const drawn = drawTrail(trail, {})
    const [walk] = drawn.walks
    // The dots, by when they were: the stay before the walk and the one after.
    const [before, after] = drawn.dots.sort((a, b) => a.to - b.to).map((dot) => dot.center)
    assert.deepEqual([walk!.points[0]!.lat, walk!.points[0]!.lon], [before!.lat, before!.lon])
    assert.deepEqual([walk!.points.at(-1)!.lat, walk!.points.at(-1)!.lon], [after!.lat, after!.lon])
    assert.equal(walk!.snapped, false)
  })

  test('a snapped walk follows its line, between the dots', () => {
    const line = [move.points[0]!, move.points[10]!, move.points.at(-1)!].map(({ lat, lon }) => ({ lat, lon }))
    const walk = drawTrail(trail, { [walkKey(move.points)]: line }).walks[0]!
    assert.equal(walk.snapped, true)
    assert.equal(walk.points.length, 5)
    assert.deepEqual(
      walk.points.slice(1, 4).map(({ lat, lon }) => ({ lat, lon })),
      line,
    )
  })

  test('the latest outing is drawn in front, older ones faint', () => {
    const twice = new Trip().stay(30).walk(10).walk(10, -4).stay(25).walk(10)
    const drawn = drawTrail(view(twice), {})
    const [older, latest] = [drawn.walks[0]!, drawn.walks.at(-1)!]
    assert.ok(drawn.opacity(older.points.at(-1)!.time) <= 0.25)
    assert.ok(drawn.opacity(latest.points[0]!.time) >= 0.55)
    assert.ok(drawn.opacity(latest.points.at(-1)!.time) > drawn.opacity(latest.points[0]!.time), 'newer, stronger')
  })
})

describe('toTrailFeatures', () => {
  test('walks in pieces of three hops for fading, and whole for paw prints; stays as dots', () => {
    const trail = view(new Trip().stay(10).walk(10).stay(10))
    const { trail: features, paws } = toTrailFeatures({ 1: trail }, {})
    const walk = drawTrail(trail, {}).walks[0]!
    const lines = features.features.filter((feature) => feature.properties.kind === 'move')
    assert.equal(lines.length, Math.ceil((walk.points.length - 1) / 3))
    assert.equal(paws.features.length, 1)
    assert.equal(paws.features[0]!.geometry.coordinates.length, walk.points.length)
    const dots = features.features.filter((feature) => feature.properties.kind === 'stay')
    assert.equal(dots.length, 2)
    assert.ok(dots.every((dot) => dot.properties.minutes! > 9))
  })
})

describe('the trail as reports come', () => {
  // A made-up day shaped like one of Kofi's: a fix every 30 s while awake, asleep for hours at home
  // (no reports), indoor fixes scattered up to 25 m, some weak; waking up 40–60 m off with weak fixes; a
  // trip to the pee spot 80 m off; a walk out to a park, pottering about there, and back; a weak run
  // into a courtyard and back. Positions in metres east and north of home, from a seeded random.
  let seed = 7
  const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647
  const points: TrailPoint[] = []
  let [x, y, time] = [0, 0, START.time]
  const report = (valid: boolean, satellites = 14) =>
    points.push({
      lat: START.lat + y / METERS_PER_DEGREE_LAT,
      lon: START.lon + x / METERS_PER_DEGREE_LON,
      time,
      valid,
      satellites: valid ? satellites : 0,
    })
  const step = () => (time += 30_000)
  const indoors = (minutes: number) => {
    for (let i = 0; i < minutes * 2; i++) {
      step()
      ;[x, y] = [(random() - 0.5) * 50, (random() - 0.5) * 50]
      report(true, random() < 0.3 ? 6 : 12)
    }
    ;[x, y] = [0, 0]
  }
  const sleep = (minutes: number) => {
    time += minutes * 60_000
    report(false)
    step()
    report(false)
  }
  const walkTo = (toX: number, toY: number, minutes: number, satellites = 14) => {
    const [fromX, fromY, steps] = [x, y, minutes * 2]
    for (let i = 1; i <= steps; i++) {
      step()
      ;[x, y] = [fromX + ((toX - fromX) * i) / steps, fromY + ((toY - fromY) * i) / steps]
      report(true, satellites)
    }
  }
  indoors(5)
  sleep(90)
  // Waking up off where it slept, weak, then settling back.
  for (const [dx, dy] of [
    [45, 10],
    [50, -20],
    [38, 30],
  ] as const) {
    step()
    ;[x, y] = [dx, dy]
    report(true, 6)
  }
  indoors(8)
  // The pee spot and back.
  walkTo(80, 0, 1.5)
  walkTo(82, 4, 2)
  walkTo(0, 0, 1.5)
  indoors(30)
  // A walk to the park, pottering about there, and home.
  walkTo(300, 0, 5)
  for (let i = 0; i < 30; i++) walkTo(300 + (random() - 0.5) * 80, (random() - 0.5) * 80, 0.5)
  walkTo(0, 0, 6)
  indoors(10)
  sleep(180)
  // A weak run into the courtyard and back.
  walkTo(0, 70, 1, 5)
  walkTo(0, 0, 1, 5)
  indoors(10)

  const end = (piece: TrailPiece) => (piece.kind === 'move' ? piece.points.at(-1)!.time : piece.kind === 'stay' ? piece.to : piece.to.time)
  const start = (piece: TrailPiece) =>
    piece.kind === 'move' ? piece.points[0]!.time : piece.kind === 'stay' ? piece.from : piece.from.time
  const home: Place = {
    id: 1,
    name: 'Home',
    area: { kind: 'circle', center: { lat: START.lat, lon: START.lon }, radius: 50 },
    assetIds: [1],
  }
  const trails = points.map((_, index) => trailView(points.slice(0, index + 1), [home], 1, 'sinotrack'))
  const final = trails.at(-1)!

  test('the day reads as it was: home, the pee spot, home, the walk with a stop in the park, home', () => {
    // Home twice at first: waking up 40–60 m off reads as a gap in the trail, not as staying on.
    const summary = final.pieces.map((piece) => (piece.kind === 'stay' ? (piece.atPlace ? 'home' : 'stop') : piece.kind))
    assert.deepEqual(summary, ['home', 'home', 'move', 'home', 'move', 'stop', 'move', 'home'])
  })

  test('its pieces follow one another in time', () => {
    for (const trail of trails) {
      trail?.pieces.slice(1).forEach((piece, index) => assert.ok(start(piece) >= end(trail.pieces[index]!)))
    }
  })

  test('a piece that ended a quarter of an hour before the newest fix stays as it is (or a stay carries on)', () => {
    trails.forEach((trail, index) => {
      const newest = points[index]!.time
      for (const piece of trail?.pieces ?? []) {
        if (end(piece) > newest - 15 * 60_000) continue
        const kept = final.pieces.some(
          (other) =>
            JSON.stringify(other) === JSON.stringify(piece) ||
            (piece.kind === 'stay' && other.kind === 'stay' && other.from === piece.from && other.to >= piece.to),
        )
        assert.ok(kept, `the ${piece.kind} from ${new Date(start(piece)).toISOString()}, as of ${new Date(newest).toISOString()}`)
      }
    })
  })

  test('whenever the trail starts, it is the whole trail from one of its pieces on', () => {
    for (let from = START.time; from <= points.at(-1)!.time; from += 5 * 60_000) {
      const shown = shownFrom(final, from)
      if (shown) assert.deepEqual(shown.pieces, final.pieces.slice(final.pieces.indexOf(shown.pieces[0]!)))
    }
  })
})

describe('alongPaths', () => {
  const points = [
    { lat: 1, lon: 1, time: 0 },
    { lat: 2, lon: 2, time: 30_000 },
    { lat: 3, lon: 3, time: 90_000 },
  ]

  test('without a line, the fixes as recorded', () => {
    assert.equal(alongPaths(points, undefined), points)
    assert.equal(alongPaths(points, []), points)
  })

  test('a line of one point is that point, at the end', () => {
    assert.deepEqual(alongPaths(points, [{ lat: 5, lon: 5 }]), [{ lat: 5, lon: 5, time: 90_000 }])
  })

  test("the line's points get times spread evenly from the first fix to the last", () => {
    const line = [0, 1, 2, 3].map((n) => ({ lat: n, lon: n }))
    assert.deepEqual(
      alongPaths(points, line).map((point) => point.time),
      [0, 30_000, 60_000, 90_000],
    )
  })
})
