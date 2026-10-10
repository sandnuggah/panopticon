import { circleWkt, parseArea, type Place, type PlaceVisit } from '../lib/places'
import type { LatLon } from '../lib/segments'
import { attempt, type EditResult } from './manage.server'
import { createGeofence, deleteGeofence, getDevices, getEvents, getGeofences, linkGeofence, updateGeofence } from './traccar.server'

// Places are Traccar geofences linked to devices. Traccar does the work: it checks every position
// against the device's geofences (a position's `geofenceIds`) and records geofenceEnter and
// geofenceExit events. Traccar enforces who may change them (see manage.server.ts).

/** How far back an asset's arrivals and departures are shown, and how many. */
const VISITS_DAYS = 7
const MAX_VISITS = 10

/** The user's places that panopticon can show (circles and simple polygons), with the assets linked to each. */
export async function loadPlaces(token: string): Promise<Place[]> {
  const [geofences, devices] = await Promise.all([getGeofences(token), getDevices(token)])
  // Traccar lists a device's geofences but not a geofence's devices: one request per device.
  const linked = await Promise.all(devices.map((device) => getGeofences(token, device.id)))
  const places: Place[] = []
  for (const geofence of geofences) {
    const area = parseArea(geofence.area)
    if (!area) continue
    const assetIds = devices.filter((_, index) => linked[index]!.some((other) => other.id === geofence.id)).map((device) => device.id)
    places.push({ id: geofence.id, name: geofence.name, area, assetIds })
  }
  return places.sort((a, b) => a.name.localeCompare(b.name))
}

export type PlaceChange = {
  /** Undefined for a new place. */
  id?: number
  name: string
  /** The new circle, or null to keep the area (a polygon drawn in Traccar). */
  circle: { center: LatLon; radius: number } | null
  assetIds: number[]
}

/** Adds or changes a place, then links it to exactly these assets. */
export function savePlace(token: string, change: PlaceChange): Promise<EditResult<{ id: number }>> {
  return attempt(token, async () => {
    const area = change.circle ? circleWkt(change.circle.center, change.circle.radius) : null
    let id = change.id
    if (id === undefined) {
      if (!area) throw new Error('A new place needs a circle')
      id = (await createGeofence(token, change.name, area)).id
    } else {
      await updateGeofence(token, id, change.name, area)
    }
    const devices = await getDevices(token)
    const linked = await Promise.all(devices.map((device) => getGeofences(token, device.id)))
    for (const [index, device] of devices.entries()) {
      const isLinked = linked[index]!.some((geofence) => geofence.id === id)
      const shouldBe = change.assetIds.includes(device.id)
      if (isLinked !== shouldBe) await linkGeofence(token, device.id, id, shouldBe)
    }
    return { ok: true, id }
  })
}

/** Removes a place; Traccar drops its links and keeps its past events. */
export function removePlace(token: string, id: number): Promise<EditResult> {
  return attempt(token, async () => {
    await deleteGeofence(token, id)
    return { ok: true }
  })
}

/** An asset's latest arrivals and departures, newest first, from Traccar's events. */
export async function loadVisits(token: string, assetId: number): Promise<PlaceVisit[]> {
  const to = new Date()
  const from = new Date(to.getTime() - VISITS_DAYS * 24 * 3600_000)
  const events = await getEvents(token, assetId, ['geofenceEnter', 'geofenceExit'], from, to)
  return events
    .filter((event) => event.geofenceId > 0)
    .map((event) => ({ assetId, placeId: event.geofenceId, arrived: event.type === 'geofenceEnter', time: event.eventTime }))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, MAX_VISITS)
}
