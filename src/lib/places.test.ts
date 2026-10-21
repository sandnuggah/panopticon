import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  circleWkt,
  durationLabel,
  parseArea,
  parseWayIn,
  placeCenter,
  radiusLabel,
  streetOf,
  trailPlaces,
  visitRows,
  visitSentence,
  visitsBetween,
  wayInAttribute,
  withinArea,
  type Place,
} from './places.ts'

describe('parseArea', () => {
  test("a circle: latitude first, radius in metres, as Traccar's own UI writes it", () => {
    assert.deepEqual(parseArea('CIRCLE (59.3577 18.0912, 120)'), { kind: 'circle', center: { lat: 59.3577, lon: 18.0912 }, radius: 120 })
    assert.deepEqual(parseArea('circle(-33.9 151.2,50.5)'), { kind: 'circle', center: { lat: -33.9, lon: 151.2 }, radius: 50.5 })
  })

  test('a polygon, latitude first', () => {
    assert.deepEqual(parseArea('POLYGON ((59.1 18.1, 59.2 18.1, 59.2 18.2, 59.1 18.1))'), {
      kind: 'polygon',
      ring: [
        { lat: 59.1, lon: 18.1 },
        { lat: 59.2, lon: 18.1 },
        { lat: 59.2, lon: 18.2 },
        { lat: 59.1, lon: 18.1 },
      ],
    })
  })

  test("shapes that aren't places, and nonsense, are null", () => {
    assert.equal(parseArea('LINESTRING (59.1 18.1, 59.2 18.2)'), null)
    assert.equal(parseArea('POLYGON ((59.1 18.1, 59.2 18.2), (59.15 18.15, 59.16 18.16, 59.17 18.15))'), null)
    assert.equal(parseArea('POLYGON ((59.1 18.1, 59.2 18.2))'), null)
    assert.equal(parseArea('CIRCLE (91 18, 100)'), null)
    assert.equal(parseArea('CIRCLE (59 18, 0)'), null)
    assert.equal(parseArea('CIRCLE (59 18 100)'), null)
    assert.equal(parseArea(''), null)
  })

  test('circleWkt writes what parseArea reads', () => {
    const wkt = circleWkt({ lat: 59.35770049, lon: 18.09121 }, 149.6)
    assert.equal(wkt, 'CIRCLE (59.357700 18.091210, 150)')
    assert.deepEqual(parseArea(wkt), { kind: 'circle', center: { lat: 59.3577, lon: 18.09121 }, radius: 150 })
  })
})

describe('places', () => {
  test("a polygon's centre is the middle of its bounds", () => {
    const area = parseArea('POLYGON ((59 18, 59 18.4, 59.2 18.4, 59 18))')!
    assert.deepEqual(placeCenter(area), { lat: 59.1, lon: 18.2 })
  })

  test('visitsBetween: leaving and arriving, one per place that changed', () => {
    assert.deepEqual(visitsBetween(3, [1, 2], [2, 5], 'T'), [
      { assetId: 3, placeId: 1, arrived: false, time: 'T' },
      { assetId: 3, placeId: 5, arrived: true, time: 'T' },
    ])
    assert.deepEqual(visitsBetween(3, [2], [2], 'T'), [])
  })

  test('visitRows: each departure is out until the next arrival, anywhere', () => {
    const visit = (placeId: number, arrived: boolean, time: string) => ({ placeId, arrived, time })
    // Newest first: home again, out from home, at daycare, then left it and nothing since.
    assert.deepEqual(visitRows([visit(2, true, '17:47'), visit(2, false, '16:58'), visit(1, true, '14:47'), visit(1, false, '09:30')]), [
      { kind: 'arrived', placeId: 2, time: '17:47' },
      { kind: 'out', placeId: 2, time: '16:58', until: '17:47' },
      { kind: 'arrived', placeId: 1, time: '14:47' },
      { kind: 'out', placeId: 1, time: '09:30', until: '14:47' },
    ])
    // Out now: no arrival since.
    assert.deepEqual(visitRows([visit(2, false, '18:10'), visit(2, true, '17:47')])[0], {
      kind: 'out',
      placeId: 2,
      time: '18:10',
      until: null,
    })
    // Left two places at once: both out until the same arrival.
    const both = visitRows([visit(3, true, '12:00'), visit(1, false, '11:00'), visit(2, false, '11:00')])
    assert.deepEqual(
      both.map((row) => (row.kind === 'out' ? row.until : null)),
      [null, '12:00', '12:00'],
    )
  })

  test('durations', () => {
    assert.equal(durationLabel(20_000), '1 min')
    assert.equal(durationLabel(49 * 60_000), '49 min')
    assert.equal(durationLabel(120 * 60_000), '2 h')
    assert.equal(durationLabel(125 * 60_000), '2 h 5 min')
    assert.equal(durationLabel(27 * 3_600_000), '1 d 3 h')
    assert.equal(durationLabel(48 * 3_600_000), '2 d')
  })

  test('labels', () => {
    assert.equal(visitSentence('Betty', { arrived: true }, 'Daycare'), 'Betty arrived at Daycare')
    assert.equal(radiusLabel(75), '75 m')
    assert.equal(radiusLabel(1500), '1.5 km')
    assert.equal(radiusLabel(2000), '2 km')
  })
})

describe('withinArea', () => {
  // About 11 m per 0.0001° of latitude.
  test('a circle, and a margin around it', () => {
    const area = parseArea('CIRCLE (59.3 18.07, 50)')!
    assert.equal(withinArea(area, { lat: 59.3004, lon: 18.07 }, 0), true)
    assert.equal(withinArea(area, { lat: 59.3006, lon: 18.07 }, 0), false)
    assert.equal(withinArea(area, { lat: 59.3006, lon: 18.07 }, 25), true)
  })

  test('a polygon, and a margin around it', () => {
    const area = parseArea('POLYGON ((59.3 18.07, 59.301 18.07, 59.301 18.072, 59.3 18.072, 59.3 18.07))')!
    assert.equal(withinArea(area, { lat: 59.3005, lon: 18.071 }, 0), true)
    assert.equal(withinArea(area, { lat: 59.3012, lon: 18.071 }, 0), false)
    assert.equal(withinArea(area, { lat: 59.3012, lon: 18.071 }, 25), true)
    assert.equal(withinArea(area, { lat: 59.3015, lon: 18.071 }, 25), false)
  })
})

describe('trailPlaces', () => {
  test("only the asset's own places, at their middles", () => {
    const places: Place[] = [
      { id: 1, name: 'Home', area: parseArea('CIRCLE (59.3 18.07, 50)')!, assetIds: [30] },
      { id: 2, name: 'Daycare', area: parseArea('CIRCLE (59.35 18.09, 120)')!, assetIds: [10] },
    ]
    const mine = trailPlaces(places, 30)
    assert.equal(mine.length, 1)
    assert.deepEqual(mine[0]!.center, { lat: 59.3, lon: 18.07 })
    assert.equal(mine[0]!.within({ lat: 59.3006, lon: 18.07 }, 25), true)
  })

  test("a place's way in, where it has one, is its dot", () => {
    const home: Place = {
      id: 1,
      name: 'Home',
      area: parseArea('CIRCLE (59.3 18.07, 50)')!,
      assetIds: [30],
      wayIn: { lat: 59.3003, lon: 18.0702 },
    }
    assert.deepEqual(trailPlaces([home], 30)[0]!.center, { lat: 59.3003, lon: 18.0702 })
  })
})

describe('address and way in', () => {
  test('a way in is kept as latitude and longitude, and read back', () => {
    const attribute = wayInAttribute({ lat: 59.30661234, lon: 18.0804 })
    assert.equal(attribute, '59.306612 18.080400')
    assert.deepEqual(parseWayIn(attribute), { lat: 59.306612, lon: 18.0804 })
    assert.equal(parseWayIn('somewhere'), undefined)
    assert.equal(parseWayIn('91 18'), undefined)
    assert.equal(parseWayIn(undefined), undefined)
  })

  test('the street in an address, without house numbers', () => {
    assert.equal(streetOf('Bohusgatan 12, 116 67 Stockholm'), 'Bohusgatan')
    assert.equal(streetOf('12 Main Street, Springfield'), 'Main Street')
    assert.equal(streetOf('Rue de la Paix 4b'), 'Rue de la Paix')
    assert.equal(streetOf('116 67, Stockholm'), null)
  })
})
