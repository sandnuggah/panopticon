import { createServerFn } from '@tanstack/react-start'
import { loadPlaces, loadVisits, removePlace, savePlace, type PlaceChange } from './places.server'
import { withToken } from './session.server'

// Traccar stores geofence names in a 128-character column.
const MAX_NAME_LENGTH = 128
/** Metres. The editor offers 50 m to 2 km (PLACE_RADII), but keeps a radius set in Traccar until it's moved. */
const MAX_RADIUS = 100_000

export const getPlaces = createServerFn({ method: 'GET' }).handler(() => withToken(loadPlaces))

/** Adds a place (no `id`) or changes one. */
export const savePlaceChange = createServerFn({ method: 'POST' })
  .validator((input: unknown): PlaceChange => {
    const { id, name, circle, assetIds } = fields(input)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH) throw new Error('Invalid request')
    if (!Array.isArray(assetIds) || !assetIds.every(isId)) throw new Error('Invalid request')
    const change: PlaceChange = { name: name.trim(), circle: null, assetIds: [...new Set(assetIds)] }
    if (id !== undefined) {
      if (!isId(id)) throw new Error('Invalid request')
      change.id = id
    }
    if (circle !== null) {
      const { center, radius } = fields(circle)
      const { lat, lon } = fields(center)
      const valid = typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      if (!valid || typeof radius !== 'number' || !(radius >= 1 && radius <= MAX_RADIUS)) throw new Error('Invalid request')
      change.circle = { center: { lat, lon }, radius }
    } else if (change.id === undefined) {
      throw new Error('Invalid request')
    }
    return change
  })
  .handler(({ data }) => withToken((token) => savePlace(token, data)))

export const deletePlace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { id } = fields(input)
    if (!isId(id)) throw new Error('Invalid request')
    return id
  })
  .handler(({ data: id }) => withToken((token) => removePlace(token, id)))

/** An asset's latest arrivals and departures, for its details card. */
export const getPlaceVisits = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    if (!isId(input)) throw new Error('Invalid request')
    return input
  })
  .handler(({ data: assetId }) => withToken((token) => loadVisits(token, assetId)))

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid request')
  return input as Record<string, unknown>
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
