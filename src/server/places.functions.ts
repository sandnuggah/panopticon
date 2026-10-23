import { createServerFn } from '@tanstack/react-start'
import type { LatLon } from '../lib/segments'
import { searchAddress } from './geocode.server'
import { loadPlaces, removePlace, savePlace, type PlaceChange } from './places.server'
import { withToken } from './session.server'

// Traccar stores geofence names in a 128-character column.
const MAX_NAME_LENGTH = 128
/** Metres. The editor offers 50–100 m (PLACE_RADII), but keeps a radius set in Traccar until it's moved. */
const MAX_RADIUS = 100_000
const MAX_ADDRESS_LENGTH = 200

export const getPlaces = createServerFn({ method: 'GET' }).handler(() => withToken(loadPlaces))

/** Adds a place (no `id`) or changes one. */
export const savePlaceChange = createServerFn({ method: 'POST' })
  .validator((input: unknown): PlaceChange => {
    const { id, name, circle, assetIds, address, found } = fields(input)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH) throw new Error('Invalid request')
    if (!Array.isArray(assetIds) || !assetIds.every(isId)) throw new Error('Invalid request')
    if (address != null && (typeof address !== 'string' || address.trim().length > MAX_ADDRESS_LENGTH)) throw new Error('Invalid request')
    const change: PlaceChange = {
      name: name.trim(),
      circle: null,
      assetIds: [...new Set(assetIds)],
      address: typeof address === 'string' ? address.trim() || null : null,
      found: found == null ? null : point(found),
    }
    if (id !== undefined) {
      if (!isId(id)) throw new Error('Invalid request')
      change.id = id
    }
    if (circle !== null) {
      const { center, radius } = fields(circle)
      if (typeof radius !== 'number' || !(radius >= 1 && radius <= MAX_RADIUS)) throw new Error('Invalid request')
      change.circle = { center: point(center), radius }
    } else if (change.id === undefined) {
      throw new Error('Invalid request')
    }
    return change
  })
  .handler(({ data }) => withToken((token) => savePlace(token, data)))

/** Addresses matching what's typed, those near the map first (see geocode.server.ts). POST so they stay out of URLs and logs. */
export const findAddresses = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { query, near } = fields(input)
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_ADDRESS_LENGTH) throw new Error('Invalid request')
    return { query: query.trim(), near: near == null ? null : point(near) }
  })
  .handler(({ data }) => withToken(() => searchAddress(data.query, data.near)))

export const deletePlace = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { id } = fields(input)
    if (!isId(id)) throw new Error('Invalid request')
    return id
  })
  .handler(({ data: id }) => withToken((token) => removePlace(token, id)))

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid request')
  return input as Record<string, unknown>
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function point(input: unknown): LatLon {
  const { lat, lon } = fields(input)
  if (typeof lat !== 'number' || typeof lon !== 'number' || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) {
    throw new Error('Invalid request')
  }
  return { lat, lon }
}
