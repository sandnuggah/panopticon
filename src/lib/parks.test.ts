import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isInPark, parkFromRings } from './parks.ts'

describe('parks', () => {
  // A square park with a square hole (a building) in its middle; [lon, lat] as in GeoJSON.
  const park = parkFromRings([
    [
      [18.0, 59.0],
      [18.1, 59.0],
      [18.1, 59.1],
      [18.0, 59.1],
      [18.0, 59.0],
    ],
    [
      [18.04, 59.04],
      [18.06, 59.04],
      [18.06, 59.06],
      [18.04, 59.06],
      [18.04, 59.04],
    ],
  ])!

  test('inside the outline, outside its holes', () => {
    assert.equal(isInPark({ lat: 59.02, lon: 18.02 }, [park]), true)
    assert.equal(isInPark({ lat: 59.05, lon: 18.05 }, [park]), false, 'in the hole')
    assert.equal(isInPark({ lat: 59.2, lon: 18.05 }, [park]), false, 'outside')
    assert.equal(isInPark({ lat: 59.02, lon: 18.02 }, []), false, 'no parks')
  })

  test('too few points is no park', () => {
    assert.equal(
      parkFromRings([
        [
          [18, 59],
          [18.1, 59],
        ],
      ]),
      null,
    )
  })
})
