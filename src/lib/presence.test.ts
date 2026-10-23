import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Place } from './places.ts'
import {
  currentStays,
  keepFrom,
  startsInVisit,
  news,
  placeStays,
  placeVisits,
  presenceOf,
  presences,
  shownAssets,
  shownLocation,
  whileLoading,
  type Presence,
  type Visit,
} from './presence.ts'
import { DEFAULT_TRAIL_PROFILE } from './segments.ts'
import { TRAIL_PROFILES } from './tracker.ts'
import type { TrailPoint } from './trail.ts'

// Home: a 50 m circle; fixes in metres east of its middle, a step of 30 s, with so many satellites
// (an ST-904L's: under 10 is weak).
const HOME = { lat: 59.3, lon: 18.07 }
const START = Date.parse('2026-10-19T05:00:00Z')
const METERS_PER_DEGREE_LON = 111_320 * Math.cos((HOME.lat * Math.PI) / 180)
const home: Place = { id: 1, name: 'Home', area: { kind: 'circle', center: HOME, radius: 50 }, assetIds: [7] }
const at = (east: number, step: number, satellites = 14, valid = true): TrailPoint => ({
  lat: HOME.lat,
  lon: HOME.lon + east / METERS_PER_DEGREE_LON,
  time: START + step * 30_000,
  valid,
  satellites,
})
/** Fixes at these distances east, one a step from `from`. */
const run = (from: number, ...easts: number[]) => easts.map((east, index) => at(east, from + index))
const visits = (points: TrailPoint[], now = points.at(-1)!.time + 30_000, places = [home]) =>
  placeVisits(points, places, 7, DEFAULT_TRAIL_PROFILE, now)
const indoors = run(0, 0, 20, -15, 30, 10, -25, 5, 15)

describe('placeVisits', () => {
  test('there from the first fix inside: may have come earlier', () => {
    assert.deepEqual(visits(indoors), [{ place: 1, from: START, to: null, known: false }])
  })

  test('left after two good fixes in a row more than 15 m outside, from the first of them', () => {
    const points = [...indoors, ...run(8, 80, 120, 200)]
    assert.deepEqual(visits(points), [{ place: 1, from: START, to: at(80, 8).time, known: false }])
  })

  test('not on fixes wandering out and back (one out, or 15 m past the edge)', () => {
    assert.equal(visits([...indoors, ...run(8, 90, 10, 60, 64, 20)])[0]!.to, null)
  })

  test('two good fixes out in a row are enough; not one good and one weak, nor out, in, out', () => {
    assert.equal(visits([...indoors, ...run(8, 80, 120)])[0]!.to, at(80, 8).time)
    assert.equal(visits([...indoors, at(80, 8), at(120, 9, 6)])[0]!.to, null, 'one weak')
    assert.equal(visits([...indoors, ...run(8, 70, 30, 72)])[0]!.to, null, 'not in a row')
  })

  test('out is more than 15 m past the edge', () => {
    assert.equal(visits([...indoors, ...run(8, 66, 67)])[0]!.to, at(66, 8).time)
    assert.equal(visits([...indoors, ...run(8, 64, 64.5)])[0]!.to, null)
  })

  test('not on weak fixes out: indoors, GPS finding itself again', () => {
    const canal = [at(-320, 8, 7), at(-330, 9, 4), at(-330, 10, 4), at(-330, 11, 4)]
    assert.equal(visits([...indoors, ...canal])[0]!.to, null)
  })

  test('weak fixes out at least four in a row, over a minute and a half, not stuck on one position: left', () => {
    // At the park's edge after a night indoors (the tracker asleep), 5–7 satellites.
    const sniffing = [at(103, 900, 6), at(102, 901, 7), at(96, 902, 7), at(89, 903, 7)]
    assert.equal(visits([...indoors, ...sniffing])[0]!.to, at(103, 900).time)
    // Repeating its position, to well within half a metre.
    const stuck = [at(103, 900, 6), at(103.2, 901, 6), at(103.4, 902, 6), at(103.2, 903, 6)]
    assert.equal(visits([...indoors, ...stuck])[0]!.to, null, 'GPS stuck')
    assert.equal(visits([...indoors, ...sniffing.slice(0, 3)])[0]!.to, null, 'three')
    const slow = sniffing.slice(0, 3).map((fix, index) => ({ ...fix, time: at(0, 900).time + index * 45_000 }))
    assert.equal(visits([...indoors, ...slow])[0]!.to, null, 'three, over a minute and a half')
    const quick = sniffing.map((fix, index) => ({ ...fix, time: at(0, 900).time + index * 20_000 }))
    assert.equal(visits([...indoors, ...quick])[0]!.to, null, 'over a minute')
    const two = [at(103, 900, 6), at(98, 901, 7), at(103, 902, 6), at(98, 903, 7)]
    assert.equal(visits([...indoors, ...two])[0]!.to, null, 'two positions')
  })

  test('a run out starts again after the tracker slept: not left at a fix out the night before', () => {
    // A good fix 20 m past the edge, 7.5 hours asleep, then out in the morning.
    const night = [...indoors, at(70, 8)]
    assert.equal(visits([...night, ...run(900, 200, 260)])[0]!.to, at(200, 900).time)
    const weak = [...indoors, at(70, 8, 6), ...[110, 120, 130].map((east, index) => at(east, 900 + index, 6))]
    assert.equal(visits(weak)[0]!.to, null, 'three weak ones in the morning')
  })

  test('a position repeated is a fix out all the same: still at the pee spot', () => {
    // An ST-904L that's still repeats its position to the centimetre.
    assert.equal(visits([...indoors, at(75, 8), at(75, 9), at(75, 10)])[0]!.to, at(75, 8).time)
  })

  test('a jump out, too fast for a walk, has to last 3 minutes, unless it goes on further', () => {
    // 300 m in 30 s, then still: GPS, until it's been out there for 3 minutes.
    const jump = run(8, 300, 302, 301)
    assert.equal(visits([...indoors, ...jump])[0]!.to, null)
    assert.equal(visits([...indoors, ...run(8, 300, 302, 301, 303, 300, 302)])[0]!.to, null, '2.5 minutes')
    const stayed = run(8, 300, 302, 301, 303, 300, 302, 301)
    assert.equal(visits([...indoors, ...stayed])[0]!.to, at(300, 8).time)
    assert.equal(visits([...indoors, ...run(8, 140, 142, 141)])[0]!.to, null, '125 m in 30 s')
    // 80 m in 20 s is a jump; 50 m isn't, however fast.
    const quick = { ...at(95, 8), time: at(15, 7).time + 20_000 }
    assert.equal(visits([...indoors, quick, at(97, 9), at(96, 10)])[0]!.to, null, '80 m')
    const near = [...indoors.slice(0, -1), at(30, 7), { ...at(80, 8), time: at(30, 7).time + 9_000 }, at(81, 9)]
    assert.equal(visits(near)[0]!.to, at(30, 7).time + 9_000, '50 m')
    // Driving off: further on at every fix.
    assert.equal(visits([...indoors, ...run(8, 330, 660)])[0]!.to, at(330, 8).time)
    // Drifting on, but not as far as a drive: GPS.
    assert.equal(visits([...indoors, at(131, 8), at(161, 9), at(30, 10)])[0]!.to, null, 'drifting 30 m')
  })

  test('a jump out that comes back towards home is GPS finding itself, however long it stays out', () => {
    // As on 16/10 14:53 at Kofi's: 150 m out, back to 87 m, stuck there, asleep 7 minutes, and waking
    // up just outside the margin on the other side.
    const settling = [at(150, 8, 7), at(152, 9, 12), at(116, 10, 9), ...[11, 12, 13, 14].map((step) => at(87, step, 10))]
    assert.equal(visits([...indoors, ...settling])[0]!.to, null)
    const later = [...indoors, ...settling, at(-66, 28, 6), at(-30, 30)]
    assert.equal(visits(later)[0]!.to, null, 'over 3 minutes, and asleep')
  })

  test('driven off with no fix on the way (300 m or more): left at the first fix out, whatever follows', () => {
    // 2 km in 3 minutes, two fixes there, then one 30 m back (to a door) and asleep.
    const there = [2000, 2003, 1973].map((east, index) => ({ ...at(east, 13 + index), time: at(15, 7).time + 180_000 + index * 30_000 }))
    assert.equal(visits([...indoors, ...there.slice(0, 2)])[0]!.to, there[0]!.time)
    assert.equal(visits([...indoors, ...there])[0]!.to, there[0]!.time)
  })

  test('a jump out, then moving about out there for 3 minutes: left at the jump, wherever it went', () => {
    // A bolt 130 m north in 30 s, then sniffing about in the park 90–100 m south-east for 15 minutes.
    const bolt = { ...at(0, 8), lat: HOME.lat + 130 / 110_540 }
    const park = Array.from({ length: 30 }, (_, k) => ({ ...at(70 + (k % 5) * 3, 9 + k), lat: HOME.lat - (60 + (k % 3) * 4) / 110_540 }))
    assert.equal(visits([...indoors, bolt, ...park.slice(0, 5)])[0]!.to, null, 'not yet')
    assert.equal(visits([...indoors, bolt, ...park])[0]!.to, bolt.time)
  })

  test('a jump out stuck on good fixes, then asleep: GPS, not a departure', () => {
    const stuck = [...indoors, at(120, 8), at(120, 9), at(120, 10)]
    assert.equal(visits(stuck, at(120, 10).time + 3 * 3_600_000)[0]!.to, null)
    assert.equal(visits([...stuck, at(10, 370)])[0]!.to, null, 'waking up at home')
    // Waking up at the pee spot, the other side, after a few minutes: out since then.
    const peeSpot = [...stuck, ...run(24, -85, -88)]
    assert.equal(visits(peeSpot)[0]!.to, at(-85, 24).time)
  })

  test('a tracker that reports on its own interval leaves however far apart its fixes come', () => {
    // A phone every 10 minutes, walking away.
    const tenMinutes = (east: number, index: number) => at(east, 8 + index * 20)
    const away = [...indoors, ...[400, 800, 1200].map(tenMinutes)]
    assert.equal(placeVisits(away, [home], 7, TRAIL_PROFILES.phone, away.at(-1)!.time)[0]!.to, at(400, 8).time)
  })

  test('one fix out, then the same position for over 10 minutes, then on: left at that fix', () => {
    const still = [at(80, 8, 6), ...Array.from({ length: 25 }, (_, k) => at(80, 9 + k, 6))]
    assert.equal(visits([...indoors, ...still, ...run(34, 120, 160)])[0]!.to, at(80, 8).time)
  })

  test('back after two fixes inside, or one good one; from the first of them', () => {
    const out = [...indoors, ...run(8, 80, 150, 300, 150, 80)]
    const twoWeak = [at(40, 13, 6), at(20, 14, 6)]
    assert.deepEqual(
      visits([...out, ...twoWeak]).map((visit) => [visit.from, visit.to]),
      [
        [START, at(80, 8).time],
        [at(40, 13).time, null],
      ],
    )
    assert.equal(visits([...out, at(40, 13, 6)]).length, 1, 'one weak one: not yet')
    assert.equal(visits([...out, at(40, 13)]).length, 2, 'one good one')
    assert.equal(visits([...out, at(47, 13)]).length, 2, 'inside')
    assert.equal(visits([...out, at(53, 13)]).length, 1, 'just outside: not on one')
  })

  test('a good fix inside reached too fast, then one near: back, from the first', () => {
    // Trotting home at 13 km/h, then awake indoors near the edge.
    const out = [...indoors, ...run(8, 80, 150, 300, 150)]
    assert.equal(visits([...out, at(40, 12), at(58, 13)]).at(-1)!.from, at(40, 12).time)
  })

  test('not on one good fix inside reached too fast for a walk: a car going by', () => {
    const driving = [...indoors, ...run(8, 80, 150, 600, 1200), at(0, 12), at(-600, 13)]
    assert.equal(visits(driving).length, 1)
  })

  test('back after settling just outside: still for 2 minutes', () => {
    const out = [...indoors, ...run(8, 80, 150, 300, 150, 80)]
    const outside = run(13, 58, 60, 59, 61, 60)
    assert.equal(visits([...out, ...outside]).at(-1)!.from, at(58, 13).time)
    assert.equal(visits([...out, ...outside.slice(0, 4)]).length, 1, 'not before 2 minutes')
    // Walking 52 m along just outside the edge (60 m from the middle), then still: still from where it stopped.
    const around = (degrees: number, step: number): TrailPoint => ({
      ...at(60 * Math.cos((degrees * Math.PI) / 180), step),
      lat: HOME.lat + (60 * Math.sin((degrees * Math.PI) / 180)) / 110_540,
    })
    const along = [around(0, 13), around(25, 14), around(50, 15), ...[16, 17, 18, 19, 20].map((step) => around(50.5, step))]
    assert.equal(visits([...out, ...along]).at(-1)!.from, along[2]!.time)
    assert.equal(visits([...out, ...along.slice(0, 6)]).length, 1, 'not before 2 minutes still')
    // Sniffing slowly round the edge, 5 m every 30 s, then on (as on 15/10 13:25 at Kofi's): not still.
    const sniffing = [13, 14, 15, 16, 17, 18, 19].map((step, index) => around(index * 5.2, step))
    assert.equal(visits([...out, ...sniffing, ...run(20, 70, 85, 104)]).length, 1, 'sniffing')
    // Up and down the street just outside: never still.
    const pacing = [13, 14, 15, 16, 17, 18, 19, 20].map((step) => ({ ...at(62, step), lat: HOME.lat + (step % 2 ? 0.0005 : -0.0005) }))
    assert.equal(visits([...out, ...pacing]).length, 1, 'pacing')
  })

  test('back when GPS loses its fix, or the tracker sleeps, just outside: no fix for 2 minutes', () => {
    const out = [...indoors, ...run(8, 80, 150, 300, 150, 80)]
    const quiet = [...out, at(60, 13)]
    assert.equal(visits(quiet, at(60, 13).time + 119_000).length, 1)
    assert.equal(visits(quiet, at(60, 13).time + 120_000).at(-1)!.from, at(60, 13).time)
    // Passing by: the next fix within 2 minutes, on its way.
    const passing = [...out, at(60, 13), ...run(14, 120, 200, 300)]
    assert.equal(visits(passing, at(300, 16).time + 30 * 60_000).length, 1)
  })

  test('a tracker that reports all the time, every few minutes, goes quiet after its silence, not 2 minutes', () => {
    // A phone every 5 minutes, passing just outside on its way.
    const fiveMinutes = (east: number, index: number) => at(east, 8 + index * 10)
    const passing = [...indoors, ...[80, 150, 300, 60, 200, 300].map(fiveMinutes)]
    const now = passing.at(-1)!.time + 60_000
    assert.equal(placeVisits(passing, [home], 7, TRAIL_PROFILES.phone, now).length, 1)
    assert.equal(placeVisits(passing, [home], 7, TRAIL_PROFILES.sinotrack, now).length, 2, 'an ST-904L sleeps there')
  })

  test('silence and reports without a fix change nothing', () => {
    const asleep = [...indoors, at(400, 9, 0, false), at(400, 800, 0, false), at(5, 801)]
    assert.deepEqual(visits(asleep), [{ place: 1, from: START, to: null, known: false }])
    // Reports without a fix would count as good fixes out, and in.
    const noFix = (east: number, step: number): TrailPoint => ({ ...at(east, step), satellites: undefined, valid: false })
    assert.equal(visits([...indoors, noFix(200, 8), noFix(250, 9), noFix(300, 10)])[0]!.to, null, 'out')
    const out = [...indoors, ...run(8, 80, 150)]
    assert.equal(visits([...out, noFix(10, 10), noFix(20, 11), at(160, 12)]).length, 1, 'in')
  })

  test('a second outing: out since the latest; one fix out after coming back is not', () => {
    const back = [...indoors, ...run(8, 80, 120), ...run(10, 20, 10)]
    const again = [...back, ...run(12, 80, 120)]
    assert.equal(presenceOf(again, visits(again))!.since, at(80, 12).time)
    const once = [...indoors, ...run(8, 70, 75), at(20, 10), at(70, 11)]
    assert.equal(visits(once).length, 2)
    assert.equal(visits(once)[1]!.to, null)
  })

  test('a place of another asset, or none: no visits', () => {
    assert.deepEqual(visits(indoors, undefined, [{ ...home, assetIds: [8] }]), [])
  })

  test('a polygon place', () => {
    const square = (east: number) => HOME.lon + east / METERS_PER_DEGREE_LON
    const ring = [-50, 50].flatMap((x) => [-50, 50].map((y) => ({ lat: HOME.lat + y / 110_540, lon: square(x) })))
    const polygon: Place = { ...home, area: { kind: 'polygon', ring: [ring[0]!, ring[1]!, ring[3]!, ring[2]!] } }
    const points = [...indoors, ...run(8, 80, 120, 200)]
    assert.deepEqual(visits(points, undefined, [polygon]), [{ place: 1, from: START, to: at(80, 8).time, known: false }])
  })
})

describe('presenceOf', () => {
  test('at a place since it came; out since it left; from the first fix without places', () => {
    assert.deepEqual(presenceOf(indoors, visits(indoors)), { place: 1, since: START, began: false })
    const out = [...indoors, ...run(8, 80, 120, 200)]
    assert.deepEqual(presenceOf(out, visits(out)), { place: null, since: at(80, 8).time, began: true, left: 1 })
    assert.deepEqual(presenceOf(out, []), { place: null, since: START, began: false })
    assert.equal(presenceOf([at(0, 0, 0, false)], []), null, 'no fix')
  })

  test('at two places that overlap: the one it came to last', () => {
    const yard: Place = { ...home, id: 2, area: { kind: 'circle', center: HOME, radius: 100 } }
    const points = [...run(0, 300, 310, 305), ...run(3, 90, 85), ...run(5, 20, 10)]
    const both = placeVisits(points, [home, yard], 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time)
    assert.deepEqual(presenceOf(points, both), { place: 1, since: at(20, 5).time, began: true })
  })

  test('at two places that overlap from the same fix: the smaller one, whichever comes first in the list', () => {
    const area: Place = {
      ...home,
      id: 2,
      area: { kind: 'circle', center: { ...HOME, lon: HOME.lon + 300 / METERS_PER_DEGREE_LON }, radius: 600 },
    }
    for (const places of [
      [home, area],
      [area, home],
    ]) {
      assert.equal(presenceOf(indoors, placeVisits(indoors, places, 7, DEFAULT_TRAIL_PROFILE, START))!.place, 1)
    }
  })
})

describe('presences', () => {
  test("an asset without a fix in its history: at the place its latest location is in, as far as it's known", () => {
    const location = { lat: HOME.lat, lon: HOME.lon, fixTime: new Date(START).toISOString() }
    const quiet = [{ id: 7, location }]
    assert.deepEqual(presences({}, [home], {}, START, quiet), { 7: { place: 1, since: START, began: false } })
    assert.deepEqual(presences({ 7: [at(0, 0, 0, false)] }, [home], {}, START, quiet)[7]!.place, 1, 'reports without a fix')
    const away = [{ id: 7, location: { ...location, lon: HOME.lon + 200 / METERS_PER_DEGREE_LON } }]
    assert.deepEqual(presences({}, [home], {}, START, away), {})
  })
})

describe('news', () => {
  const visit = (place: number, from: number, to: number | null, known = true): Visit => ({ place, from, to, known })
  const [eleven, noon, one] = [START, START + 3_600_000, START + 7_200_000]

  test('a visit that ends is a departure, when it ended; one that begins is an arrival, when it began', () => {
    assert.deepEqual(news([visit(1, eleven, null)], [visit(1, eleven, noon)]), [{ placeId: 1, arrived: false, time: noon }])
    assert.deepEqual(news([visit(1, eleven, noon)], [visit(1, eleven, noon), visit(1, one, null)]), [
      { placeId: 1, arrived: true, time: one },
    ])
    assert.deepEqual(news([visit(1, eleven, noon)], [visit(1, eleven, noon)]), [], 'nothing new')
  })

  test('not one going on from the first fix, nor one that is gone (undone by late fixes, or cut off)', () => {
    assert.deepEqual(news([], [visit(1, eleven, null, false)]), [])
    assert.deepEqual(news([visit(1, eleven, noon), visit(1, one, null)], [visit(1, eleven, noon)]), [], 'an arrival undone')
    assert.deepEqual(news([visit(1, eleven, null)], []), [], 'cut off')
  })

  test('places inside others, each for itself', () => {
    // Home (1) inside the block (2): out of Home, still in the block; then home again.
    const block = visit(2, eleven, null)
    assert.deepEqual(news([block, visit(1, eleven, null)], [block, visit(1, eleven, noon)]), [{ placeId: 1, arrived: false, time: noon }])
    assert.deepEqual(news([block, visit(1, eleven, noon)], [block, visit(1, eleven, noon), visit(1, one, null)]), [
      { placeId: 1, arrived: true, time: one },
    ])
  })
})

describe('shownLocation', () => {
  const location = (point: TrailPoint) => ({ lat: point.lat, lon: point.lon, fixTime: new Date(point.time).toISOString(), accuracy: 12 })
  const there: Presence = { place: 1, since: START, began: false }
  const away: Presence = { place: null, since: START, began: true, left: 1 }

  test('at a place: its centre, however the fixes wander, with when it last reported', () => {
    const latest = indoors.at(-1)!
    assert.deepEqual(shownLocation(location(latest), indoors, there, [home], DEFAULT_TRAIL_PROFILE), {
      ...HOME,
      fixTime: location(latest).fixTime,
      accuracy: undefined,
    })
  })

  test('out: at its latest fix GPS has confirmed', () => {
    const walk = [...indoors, ...run(8, 80, 120, 200)]
    const canal = [at(-320, 14, 7), at(-330, 15, 4)]
    const shown = shownLocation(location(canal[1]!), [...walk, ...canal], away, [home], DEFAULT_TRAIL_PROFILE)
    assert.deepEqual([shown.lat, shown.lon, shown.accuracy], [walk.at(-1)!.lat, walk.at(-1)!.lon, undefined])
    const latest = walk.at(-1)!
    assert.equal(shownLocation(location(latest), walk, away, [home], DEFAULT_TRAIL_PROFILE).accuracy, 12, 'as it is')
  })

  test('not where a report without a fix says', () => {
    const walk = [...indoors, ...run(8, 80, 120, 200)]
    const stale = at(-500, 11, 0, false)
    const shown = shownLocation(location(stale), [...walk, stale], away, [home], DEFAULT_TRAIL_PROFILE)
    assert.deepEqual([shown.lat, shown.lon], [walk.at(-1)!.lat, walk.at(-1)!.lon])
  })

  test('as it is while the trail hasn’t caught up with it; at the place still if it’s there', () => {
    const newer = at(200, 30)
    assert.deepEqual(shownLocation(location(newer), indoors, away, [home], DEFAULT_TRAIL_PROFILE), location(newer))
    assert.deepEqual(shownLocation(location(newer), indoors, there, [home], DEFAULT_TRAIL_PROFILE), location(newer), 'gone')
    const near = at(55, 30)
    assert.deepEqual(shownLocation(location(near), indoors, there, [home], DEFAULT_TRAIL_PROFILE).lat, HOME.lat)
    assert.deepEqual(shownLocation(location(near), indoors, there, [home], DEFAULT_TRAIL_PROFILE).lon, HOME.lon)
    assert.deepEqual(shownLocation(location(near), undefined, undefined, [home], DEFAULT_TRAIL_PROFILE), location(near), 'no trail')
  })

  test('out since leaving on weak fixes after a night asleep, more than 100 m from the last: at the latest of them', () => {
    const morning = [at(103, 900, 6), at(102, 901, 7), at(96, 902, 7), at(89, 903, 7)]
    const points = [...indoors, at(-20, 8), ...morning]
    const presence = presenceOf(points, visits(points))!
    const shown = shownLocation(location(morning[3]!), points, presence, [home], DEFAULT_TRAIL_PROFILE)
    assert.deepEqual([shown.lat, shown.lon], [morning[3]!.lat, morning[3]!.lon])
  })

  test('without places (a live link): at the latest confirmed fix, not where a report without a fix says', () => {
    const walk = [...indoors, ...run(8, 80, 120, 200)]
    const noFix = { ...at(150, 11, 0, false) }
    const shown = shownLocation(location(noFix), [...walk, noFix], undefined, [], DEFAULT_TRAIL_PROFILE)
    assert.deepEqual([shown.lat, shown.lon, shown.fixTime], [walk.at(-1)!.lat, walk.at(-1)!.lon, location(noFix).fixTime])
  })

  test('shownAssets: the same asset object when it shows where it is', () => {
    const latest = indoors.at(-1)!
    const asset = { id: 7, location: location(latest) }
    assert.equal(shownAssets([asset], { 7: indoors }, {}, [home])[0], asset)
    assert.notEqual(shownAssets([asset], { 7: indoors }, { 7: there }, [home])[0], asset)
  })
})

describe('currentStays', () => {
  test('out since leaving a place: a stay since then, not the one at the place', () => {
    // At home for an hour (a fix a minute, 20–40 m east of its middle), then 68 m out, at the pee spot,
    // for 6 minutes: within 40 m of where the fixes at home were.
    const hour = Array.from({ length: 60 }, (_, minute) => at(30 + 10 * Math.cos(minute * 2.4), minute * 2))
    const spot = Array.from({ length: 13 }, (_, k) => at(68 + (k % 2) * 0.6, 120 + k))
    const points = [...hour, ...spot]
    const now = spot.at(-1)!.time + 30_000
    const presence = presenceOf(points, visits(points, now))!
    assert.equal(presence.left, 1)
    assert.equal(currentStays({ 7: points }, 1440, now, {})[7]!.since, hour[0]!.time, 'by the stops alone')
    assert.deepEqual(currentStays({ 7: points }, 1440, now, {}, { 7: presence })[7], { since: spot[0]!.time, began: true })
  })
})

describe('keepFrom', () => {
  const keep = (points: TrailPoint[], places = [home]) =>
    keepFrom(points, placeVisits(points, places, 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time), places, 7, DEFAULT_TRAIL_PROFILE)
  /** Whether the visits are the same with the trail cut where keepFrom says. */
  const sameCut = (points: TrailPoint[]) => {
    const visits = placeVisits(points, [home], 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time)
    const cut = points.filter((point) => point.time >= keep(points)!)
    assert.deepEqual(placeVisits(cut, [home], 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time).at(-1), visits.at(-1))
  }

  test('from the last fix outside the place before the visit it is at began; none while out', () => {
    const back = [...indoors, ...run(8, 80, 150, 300, 150, 80), ...run(13, 30, 10)]
    assert.equal(keep(back), at(80, 12).time)
    sameCut(back)
    assert.equal(keep([...indoors, ...run(8, 80, 150)]), undefined)
  })

  test('not a fix in the margin: cut there, it would have been there from the first fix', () => {
    // Coming home along the edge: 62 m and 58 m from the middle, then inside.
    const slow = [...indoors, ...run(8, 80, 150, 120), ...run(11, 62, 58, 40, 30)]
    assert.equal(keep(slow), at(120, 10).time)
    sameCut(slow)
  })

  test('outside all of its places, from before the earliest visit it is at, when places overlap', () => {
    // A yard 70 m east, overlapping Home: in from the west, into the yard, then the overlap, for 40 hours.
    const yard: Place = {
      ...home,
      id: 2,
      area: { kind: 'circle', center: { ...HOME, lon: HOME.lon + 70 / METERS_PER_DEGREE_LON }, radius: 45 },
    }
    const stay = Array.from({ length: 80 }, (_, k) => at(25 + (k % 3) * 3, 8 + k * 60))
    const points = [...run(0, -150, -100, -60, 60, 65, 40, 30), ...stay]
    const visits = placeVisits(points, [home, yard], 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time)
    const cut = points.filter((point) => point.time >= keep(points, [home, yard])!)
    assert.deepEqual(placeVisits(cut, [home, yard], 7, DEFAULT_TRAIL_PROFILE, points.at(-1)!.time), visits)
  })

  test('there from the first point: from it, reports without a fix too', () => {
    const asleep = [at(400, 0, 0, false), ...run(1, 0, 20, -15)]
    assert.equal(keep(asleep), asleep[0]!.time)
  })
})

describe('startsInVisit', () => {
  test('there from the first fix there is, and still', () => {
    assert.equal(startsInVisit(placeVisits(indoors, [home], 7, DEFAULT_TRAIL_PROFILE, START)), true)
    const back = [...run(0, 300, 200), ...run(2, 30, 10)]
    assert.equal(startsInVisit(placeVisits(back, [home], 7, DEFAULT_TRAIL_PROFILE, START)), false)
    const left = [...indoors, ...run(8, 80, 150, 300)]
    assert.equal(startsInVisit(placeVisits(left, [home], 7, DEFAULT_TRAIL_PROFILE, START)), false, 'left since')
  })
})

describe('whileLoading', () => {
  const there = { 7: { place: 1, since: START, began: true } }
  const report = (east: number, time = START + 600_000) => ({
    id: 7,
    location: { lat: HOME.lat, lon: HOME.lon + east / METERS_PER_DEGREE_LON, fixTime: new Date(time).toISOString() },
  })

  test('where it was, unless a location newer than its trail is outside its place by its margin: then out, since then', () => {
    const trails = { 7: indoors }
    assert.equal(whileLoading(there, [report(60)], [home], trails), there)
    assert.deepEqual(whileLoading(there, [report(120)], [home], trails)[7], { place: null, since: START + 600_000, began: false, left: 1 })
    // A fix out the trail has already (GPS wandering indoors): where its trail says.
    assert.equal(whileLoading(there, [report(120, indoors.at(-1)!.time)], [home], trails), there)
  })
})

describe('placeStays', () => {
  test('visits as the map draws them: one at a time, at the way in', () => {
    const wayIn = { lat: HOME.lat + 0.0004, lon: HOME.lon }
    const points = [...indoors, ...run(8, 80, 120, 200, 120, 30, 10)]
    assert.deepEqual(placeStays(points, [{ ...home, wayIn }], 7, DEFAULT_TRAIL_PROFILE), [
      { from: START, to: at(80, 8).time, center: wayIn },
      { from: at(30, 12).time, to: null, center: wayIn },
    ])
    // Back just outside, then nothing: there once the tracker has been quiet for 2 minutes.
    const back = [...indoors, ...run(8, 80, 120, 200, 120, 60)]
    assert.equal(placeStays(back, [home], 7, DEFAULT_TRAIL_PROFILE).length, 1)
    assert.deepEqual(placeStays(back, [home], 7, DEFAULT_TRAIL_PROFILE, true)[1], { from: at(60, 12).time, to: null, center: HOME })
    // A place much bigger than a home (a block drawn in Traccar): its visits aren't drawn as a stay.
    const block: Place = { ...home, id: 3, area: { kind: 'circle', center: HOME, radius: 300 } }
    assert.deepEqual(placeStays(indoors, [block], 7, DEFAULT_TRAIL_PROFILE), [])
    const yard: Place = { ...home, id: 2, area: { kind: 'circle', center: HOME, radius: 100 } }
    const nested = [...run(0, 300, 310, 305), ...run(3, 90, 85), ...run(5, 20, 10)]
    assert.deepEqual(
      placeStays(nested, [home, yard], 7, DEFAULT_TRAIL_PROFILE).map(({ from, to }) => [from, to]),
      [
        [at(90, 3).time, at(20, 5).time],
        [at(20, 5).time, null],
      ],
    )
  })
})
