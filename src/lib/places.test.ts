import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { circleWkt, parseArea, placeCenter, radiusLabel, visitLabel, visitSentence, visitsBetween } from './places.ts'

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

  test('labels', () => {
    assert.equal(visitLabel({ arrived: true }, 'Home'), 'Arrived at Home')
    assert.equal(visitLabel({ arrived: false }, 'Home'), 'Left Home')
    assert.equal(visitSentence('Betty', { arrived: true }, 'Daycare'), 'Betty arrived at Daycare')
    assert.equal(radiusLabel(75), '75 m')
    assert.equal(radiusLabel(1500), '1.5 km')
    assert.equal(radiusLabel(2000), '2 km')
  })
})
