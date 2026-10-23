import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchableWalks, walkId } from './matching.ts'
import type { Place } from './places.ts'
import { latestOutingStart, withDots, type LatLon, type TrailPiece } from './segments.ts'
import type { SnappedLine } from './snapLines.ts'
import type { TrailPoint } from './trail.ts'
import {
  drawTrail,
  quietAssets,
  firstShown,
  shownKey,
  shownTrails,
  toTrailFeatures,
  trailFrom,
  trailView,
  trailViews,
  type TrailView,
  type TrailViewCache,
} from './trailGeometry.ts'

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
/** A line as Snap to paths answers it, its points' times spread from `from` to `to`. */
const snappedLine = (points: LatLon[], from: number, to: number): SnappedLine => ({
  points: points.map(({ lat, lon }, index) => ({ lat, lon, time: from + ((to - from) * index) / (points.length - 1), how: 'matched' })),
  current: true,
})
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

  test('the latest outing is the whole trail’s, though the long stay it began at is no longer drawn', () => {
    // Home for half an hour, a walk, a 10-minute stop, another walk: one outing, since home.
    const outing = new Trip().stay(30).walk(10).stay(10).walk(10)
    const whole = view(outing)
    const shown = shownFrom(whole, outing.at(55))!
    assert.deepEqual(kinds(shown.pieces), ['stay', 'move'])
    assert.notEqual(whole.outing, null)
    assert.equal(shown.outing, whole.outing)
    assert.equal(latestOutingStart(shown.pieces), null, 'what the drawn pieces alone would say')
    assert.equal(shown.oldest, (shown.pieces[0] as Extract<TrailPiece, { kind: 'stay' }>).from, 'fading from the first piece drawn')
  })
})

describe('firstShown', () => {
  // Pieces by hand, minutes from the start; positions don't matter here.
  const point = (minutes: number): TrailPoint => ({ lat: START.lat, lon: START.lon, time: START.time + minutes * 60_000, valid: true })
  const stay = (from: number, to: number): TrailPiece => ({
    kind: 'stay',
    center: { lat: START.lat, lon: START.lon },
    radius: 10,
    from: point(from).time,
    to: point(to).time,
  })
  const move = (from: number, to: number): TrailPiece => ({ kind: 'move', points: [point(from), point(to)] })
  const ride = (from: number, to: number): TrailPiece => ({ kind: 'vehicle', from: point(from), to: point(to), legs: [] })
  const at = (minutes: number) => point(minutes).time

  test('a walk or ride under way, with the stay it set off from', () => {
    assert.equal(firstShown([stay(0, 10), move(12, 30)], at(15)), 0)
    assert.equal(firstShown([stay(0, 10), ride(12, 30)], at(15)), 0)
  })

  test('a stay under way, without the stay before it; one begun since, with it (the hop between their dots)', () => {
    assert.equal(firstShown([stay(0, 10), stay(12, 30)], at(15)), 1)
    assert.equal(firstShown([stay(0, 10), stay(20, 30)], at(15)), 0)
  })

  test('not what came before a stay under way, or a walk that ended before the start', () => {
    assert.equal(firstShown([move(0, 10), stay(12, 30)], at(15)), 1)
    assert.equal(firstShown([move(0, 10), stay(20, 30)], at(15)), 1, 'a stay begun since, after a walk')
    assert.equal(firstShown([stay(0, 5), move(6, 10), stay(12, 30)], at(15)), 2)
  })

  test('nothing ends after the start: none', () => {
    assert.equal(firstShown([stay(0, 10), move(12, 14)], at(15)), 2)
    assert.equal(trailFrom({ pieces: [stay(0, 10)], oldest: at(0), newest: at(10), outing: null }, 1), null)
  })

  test('a ride is no stay to set off from', () => {
    assert.equal(firstShown([ride(0, 10), move(10, 30)], at(15)), 1)
  })

  test('drawn from a walk or ride: fading from its first fix', () => {
    const view = { pieces: [stay(0, 10), move(12, 20), ride(22, 30)], oldest: at(0), newest: at(30), outing: null }
    assert.equal(trailFrom(view, 1)!.oldest, at(12))
    assert.equal(trailFrom(view, 2)!.oldest, at(22))
  })
})

describe('trailViews and shownTrails', () => {
  const trip = new Trip().stay(30).walk(20).stay(10)
  const home: Place = {
    id: 1,
    name: 'Home',
    area: { kind: 'circle', center: { lat: START.lat, lon: START.lon }, radius: 50 },
    assetIds: [1],
  }

  test('a walk under way when the trail starts is drawn whole: worked out from all the points, not those after the start', () => {
    const views = trailViews({ 1: trip.points }, [home], { 1: 'sinotrack' })
    const shown = shownTrails(views, trip.at(40))[1]!
    assert.deepEqual(kinds(shown.pieces), ['stay', 'move', 'stay'])
    assert.ok((shown.pieces[1] as Extract<TrailPiece, { kind: 'move' }>).points[0]!.time < trip.at(40))
    const after = trip.points.filter((point) => point.time >= trip.at(40))
    assert.notDeepEqual(
      kinds(trailView(after, [home], 1, 'sinotrack')!.pieces),
      kinds(shown.pieces),
      'what the points after it alone would say',
    )
  })

  test('this outing: from the stay it set off from, since the last long stay; at that stay, the outing that ended there', () => {
    const day = new Trip().stay(30).walk(20).stay(30).walk(10).stay(5).walk(10)
    const views = trailViews({ 1: day.points }, [], {})
    const shown = shownTrails(views, 'outing')[1]!
    // From the second long stay on: the walk after it, the short stop and the walk under way.
    assert.deepEqual(kinds(shown.pieces), ['stay', 'move', 'stay', 'move'])
    assert.ok(shown.oldest > day.at(40), 'not the first walk')
    const home = new Trip().stay(30).walk(20).stay(40)
    assert.deepEqual(
      kinds(shownTrails(trailViews({ 1: home.points }, [], {}), 'outing')[1]!.pieces),
      ['stay', 'move', 'stay'],
      'back at a long stay: the walk there',
    )
  })

  test('with trails off, none; an asset with nothing since the start, or no fix at all, none either', () => {
    assert.deepEqual(shownTrails(trailViews({ 1: trip.points }, [], {}), null), {})
    assert.equal(shownKey(trailViews({ 1: trip.points }, [], {}), null), 'off')
    const views = trailViews({ 1: trip.points, 2: trip.points.map((point) => ({ ...point, valid: false })) }, [], {})
    assert.deepEqual(Object.keys(views), ['1'])
    assert.deepEqual(kinds(shownTrails(views, trip.at(55))[1]!.pieces), ['stay'], 'clipped')
    assert.deepEqual(shownTrails(views, trip.at(70)), {})
  })

  test('each worked out with its own places and kind of tracker', () => {
    const points = trip.points.map((point, index) => ({ ...point, satellites: index % 3 ? 14 : 6 }))
    for (const tracker of ['sinotrack', 'phone'] as const) {
      assert.deepEqual(
        trailViews({ 7: points }, [{ ...home, assetIds: [7] }], { 7: tracker })[7],
        trailView(points, [{ ...home, assetIds: [7] }], 7, tracker),
      )
    }
    assert.equal(
      trailViews({ 7: points }, [home], {})[7]!.pieces.some((piece) => piece.kind === 'stay' && piece.atPlace),
      false,
      'not its place',
    )
  })

  test("an asset whose points, places and tracker haven't changed isn't worked out again; one gone is forgotten", () => {
    const cache: TrailViewCache = new Map()
    const [places, trails] = [[home], { 1: trip.points, 2: new Trip().stay(10).points }]
    const first = trailViews(trails, places, {}, cache)[1]
    assert.equal(trailViews({ ...trails }, places, {}, cache)[1], first, 'the same')
    const otherPlaces = [home]
    const placed = trailViews(trails, otherPlaces, {}, cache)[1]
    assert.notEqual(placed, first, 'other places')
    const tracked = trailViews(trails, otherPlaces, { 1: 'phone' }, cache)[1]
    assert.notEqual(tracked, placed, 'another kind of tracker')
    assert.notEqual(trailViews({ ...trails, 1: [...trip.points] }, otherPlaces, { 1: 'phone' }, cache)[1], tracked, 'new points')
    const quiet = trailViews(trails, otherPlaces, { 1: 'phone' }, cache, new Set([1]))[1]
    assert.notEqual(quiet, trailViews(trails, otherPlaces, { 1: 'phone' }, cache)[1], 'quiet, then not')
    trailViews({ 1: trip.points }, places, {}, cache)
    assert.deepEqual([...cache.keys()], [1])
  })

  test('quiet: an asset whose tracker has had no fix for its gap (one that sleeps when still) or its silence (one that doesn’t)', () => {
    const last = trip.points.findLast((point) => point.valid)!.time
    const trails = { 1: trip.points, 2: trip.points }
    assert.deepEqual(quietAssets(trails, { 1: 'sinotrack', 2: 'phone' }, last + 119_000), [])
    assert.deepEqual(quietAssets(trails, { 1: 'sinotrack', 2: 'phone' }, last + 120_000), [1])
    assert.deepEqual(quietAssets(trails, { 1: 'sinotrack', 2: 'phone' }, last + 600_000), [1, 2])
  })

  test('shownKey changes only when a piece drops off the old end', () => {
    const views = trailViews({ 1: trip.points }, [], {})
    assert.equal(shownKey(views, trip.at(35)), shownKey(views, trip.at(45)), 'the walk under way all along')
    assert.notEqual(shownKey(views, trip.at(45)), shownKey(views, trip.at(55)), 'the walk over')
  })
})

describe('drawTrail', () => {
  test("a stay that joins a place's dot is drawn as the place: no dot under its pin", () => {
    const at = (east: number, minutes: number): TrailPoint => ({
      lat: START.lat,
      lon: START.lon + east / METERS_PER_DEGREE_LON,
      time: START.time + minutes * 60_000,
      valid: true,
    })
    const minute = 60_000
    // A stop 25 m from Home before Home's visit is in the trail; then out and back, and home.
    const pieces: TrailPiece[] = [
      { kind: 'stay', center: at(25, 0), radius: 10, from: START.time, to: START.time + 10 * minute },
      { kind: 'move', points: [at(25, 10), at(300, 15), at(0, 20)] },
      { kind: 'stay', center: at(0, 20), radius: 10, from: START.time + 20 * minute, to: START.time + 60 * minute, atPlace: true },
    ]
    const view: TrailView = { pieces, oldest: START.time, newest: START.time + 60 * minute, outing: null }
    assert.deepEqual(
      drawTrail(view).dots.map((dot) => !!dot.atPlace),
      [true],
    )
    // Home, out, the stop, and home again, drawn from the stop on: without the first visit shown.
    const home = pieces[2] as Extract<TrailPiece, { kind: 'stay' }>
    const day = withDots([{ ...home, from: START.time - 60 * minute, to: START.time - 30 * minute }, pieces[1]!, ...pieces])
    assert.deepEqual(
      drawTrail(trailFrom({ ...view, pieces: day }, 2)!).dots.map((dot) => !!dot.atPlace),
      [true],
    )
  })
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

  test('a snapped walk follows its line, between the dots, at its points’ own times', () => {
    const line = [move.points[0]!, move.points[10]!, move.points.at(-1)!].map(({ lat, lon }) => ({ lat, lon }))
    // Most of the way in the first minute: the fading goes by when, not by how many points.
    const [from, to] = [move.points[0]!.time, move.points.at(-1)!.time]
    const timed = {
      ...snappedLine(line, from, to),
      points: snappedLine(line, from, to).points.map((point, index) => ({ ...point, time: index === 1 ? from + 60_000 : point.time })),
    }
    const walk = drawTrail(trail, { [walkId(move.points)]: timed }).walks[0]!
    assert.deepEqual([walk.snapped, walk.current], [true, true])
    assert.equal(walk.points.length, 5)
    assert.deepEqual(
      walk.points.slice(1, 4).map(({ lat, lon }) => ({ lat, lon })),
      line,
    )
    assert.equal(walk.points[2]!.time, from + 60_000)
    assert.deepEqual(
      drawTrail(trail, { [walkId(move.points)]: { points: [], current: true } }).walks[0]!.snapped,
      false,
      'an empty line: as recorded',
    )
  })

  test('two stays next to each other: a hop from dot to dot, as Snap to paths knows it, routed or straight', () => {
    const at = (east: number) => ({ lat: START.lat, lon: START.lon + east / METERS_PER_DEGREE_LON })
    const stays = (east: number): TrailView => ({
      pieces: [
        { kind: 'stay', center: at(0), radius: 10, from: START.time, to: START.time + 30 * 60_000, atPlace: true },
        { kind: 'stay', center: at(east), radius: 10, from: START.time + 31 * 60_000, to: START.time + 60 * 60_000 },
      ],
      oldest: START.time,
      newest: START.time + 60 * 60_000,
      outing: null,
    })
    const apart = stays(100)
    const [hop] = drawTrail(apart, {}).walks
    assert.equal(hop!.hop, true)
    assert.deepEqual(
      hop!.points.map(({ lat, lon }) => ({ lat, lon })),
      [at(0), at(100)],
    )
    assert.deepEqual(
      drawTrail(apart, {}).walks.map((walk) => walk.key),
      matchableWalks(apart.pieces).map((walk) => walk.id),
    )
    const route = snappedLine([at(0), at(50), at(100)], START.time + 30 * 60_000, START.time + 31 * 60_000)
    const routed = drawTrail(apart, { [hop!.key]: route })
    assert.equal(routed.walks[0]!.points.length, 5)
    assert.equal(
      toTrailFeatures({ 1: apart }, { 1: { [hop!.key]: route } }).trail.features.filter((f) => f.properties.kind === 'move').length,
      1,
    )
    assert.deepEqual(drawTrail(stays(30), {}).walks, [], 'one dot: no hop')
  })

  test('no long stay: it is all the latest outing', () => {
    const drawn = drawTrail(view(new Trip().stay(10).walk(10).stay(5)), {})
    assert.ok(drawn.walks.every((walk) => walk.points.every((point) => drawn.opacity(point.time) >= 0.55)))
  })

  test('the latest outing is drawn in front, older ones faint; each fainter the older its part', () => {
    const twice = new Trip().stay(30).walk(10).walk(10, -4).stay(25).walk(10)
    const trail = view(twice)
    const drawn = drawTrail(trail, {})
    const [older, latest] = [drawn.walks[0]!, drawn.walks.at(-1)!]
    const [olderStart, olderEnd] = [drawn.opacity(older.points[0]!.time), drawn.opacity(older.points.at(-1)!.time)]
    assert.ok(olderStart >= 0.12 && olderStart < olderEnd && olderEnd <= 0.25, 'older: 0.12 to 0.25')
    assert.ok(Math.abs(drawn.opacity(trail.outing!) - 0.55) < 0.01, 'the latest from 0.55')
    assert.ok(Math.abs(drawn.opacity(trail.newest) - 0.95) < 0.01, 'to 0.95')
    const dots = toTrailFeatures({ 1: trail }, {}).trail.features.filter((feature) => feature.properties.kind === 'stay')
    assert.deepEqual(
      dots.map((dot) => dot.properties.opacity),
      drawn.dots.map((dot) => drawn.opacity(dot.to)),
      'dots by when they were last',
    )
    assert.ok(latest.points.length > 0)
  })
})

describe('toTrailFeatures', () => {
  test('no dot at a place: its pin is there', () => {
    const at = (east: number) => ({ lat: START.lat, lon: START.lon + east / METERS_PER_DEGREE_LON })
    const stays: TrailView = {
      pieces: [
        { kind: 'stay', center: at(0), radius: 10, from: START.time, to: START.time + 30 * 60_000, atPlace: true },
        { kind: 'stay', center: at(500), radius: 10, from: START.time + 40 * 60_000, to: START.time + 60 * 60_000 },
      ],
      oldest: START.time,
      newest: START.time + 60 * 60_000,
      outing: null,
    }
    const dots = toTrailFeatures({ 1: stays }, {}).trail.features.filter((feature) => feature.properties.kind === 'stay')
    assert.deepEqual(
      dots.map((dot) => (dot.geometry as { coordinates: number[] }).coordinates[0]),
      [at(500).lon],
    )
  })

  test('each walk as one line, no beads where pieces of it overlap, and whole for paw prints; stays as dots', () => {
    const trail = view(new Trip().stay(10).walk(10).stay(10))
    const { trail: features, paws } = toTrailFeatures({ 1: trail }, {})
    const walk = drawTrail(trail, {}).walks[0]!
    const lines = features.features
      .filter((feature) => feature.properties.kind === 'move')
      .map((feature) => feature.geometry.coordinates as number[][])
    assert.equal(lines.length, 1)
    assert.equal(lines[0]!.length, walk.points.length)
    assert.deepEqual(lines[0]![0], [walk.points[0]!.lon, walk.points[0]!.lat], 'longitude first')
    assert.equal(paws.features.length, 1)
    assert.equal(paws.features[0]!.geometry.coordinates.length, walk.points.length)
    const dots = features.features.filter((feature) => feature.properties.kind === 'stay')
    assert.equal(dots.length, 2)
    assert.deepEqual(
      dots.map((dot) => dot.geometry.coordinates),
      drawTrail(trail, {}).dots.map((dot) => [dot.center.lon, dot.center.lat]),
      'longitude first',
    )
    assert.ok(
      dots.every((dot) => dot.properties.minutes! > 9 && dot.properties.minutes! < 11),
      'minutes',
    )
  })

  test('ways nobody saw as guesses of their own, cut where they begin and end; older outings behind', () => {
    const trail = view(new Trip().stay(10).walk(10).stay(10))
    const walk = drawTrail(trail, {}).walks[0]!
    // Snapped: along the line, then a routed leg of two points, then along the line again.
    const points = walk.points
      .slice(1, -1)
      .map((point, k) => ({ ...point, how: k === 4 || k === 5 ? ('routed' as const) : ('matched' as const) }))
    const { trail: features } = toTrailFeatures({ 1: trail }, { 1: { [walk.key]: { points, current: true } } })
    const moves = features.features.filter((feature) => feature.properties.kind === 'move')
    assert.deepEqual(
      moves.map((feature) => !!feature.properties.guess),
      [false, true, false],
    )
    moves.slice(1).forEach((line, index) => assert.deepEqual(line.geometry.coordinates[0], moves[index]!.geometry.coordinates.at(-1)))
    assert.ok(
      moves.every((feature) => !feature.properties.older),
      'all of one outing',
    )
    const later = view(new Trip().stay(10).walk(10).stay(30).walk(10).stay(10))
    assert.deepEqual(
      toTrailFeatures({ 1: later }, {})
        .trail.features.filter((feature) => feature.properties.kind === 'move')
        .map((feature) => !!feature.properties.older),
      [true, false],
      'the walk before the long stay is an older outing',
    )
    assert.equal(toTrailFeatures({ 1: later }, {}).paws.features.length, 1, 'paw prints for the latest outing only')
  })

  test("each trail in its asset's colour, or the default's", () => {
    const trail = view(new Trip().stay(10).walk(10).stay(10))
    const colorsOf = (colors: Record<number, string>) => [
      ...new Set(
        toTrailFeatures({ 1: trail, 2: trail }, {}, colors).trail.features.map(
          (feature) => `${feature.properties.id}:${feature.properties.color}`,
        ),
      ),
    ]
    assert.deepEqual(colorsOf({ 1: 'pink' }), ['1:pink', '2:green'])
  })

  test('a ride through its fixes, as a vehicle', () => {
    const { trail: features } = toTrailFeatures({ 1: view(new Trip().stay(10).walk(3, 60).stay(10)) }, {})
    assert.equal(features.features.filter((feature) => feature.properties.kind === 'vehicle').length, 1)
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
    // Home once at first, though it woke up 40–60 m off where it slept: it was home all along.
    const summary = final.pieces.map((piece) => (piece.kind === 'stay' ? (piece.atPlace ? 'home' : 'stop') : piece.kind))
    assert.deepEqual(summary, ['home', 'move', 'home', 'move', 'stop', 'move', 'home'])
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

  test('whenever the trail starts, it is the whole trail from one of its pieces on: those that end after it, and the stay it set off from', () => {
    for (let from = START.time; from <= points.at(-1)!.time; from += 5 * 60_000) {
      const shown = shownFrom(final, from)
      if (!shown) continue
      assert.deepEqual(shown.pieces, final.pieces.slice(final.pieces.indexOf(shown.pieces[0]!)))
      const [first, next] = shown.pieces
      if (end(first!) >= from) continue
      assert.equal(first!.kind, 'stay', `at ${new Date(from).toISOString()}`)
      assert.ok(next!.kind !== 'stay' || start(next!) >= from)
    }
  })
})
