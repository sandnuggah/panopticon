import type { LatLon } from './segments'

// Places: areas like Home or Daycare, kept in Traccar as geofences (see places.server.ts). Traccar
// works out which of an asset's places each position is inside (`geofenceIds`), and records arriving
// and leaving as events. No runtime imports, so Node can run the tests directly.

/** A circle (what panopticon draws), or a polygon drawn in Traccar's own UI. */
export type PlaceArea = { kind: 'circle'; center: LatLon; radius: number } | { kind: 'polygon'; ring: LatLon[] }

export type Place = {
  id: number
  name: string
  area: PlaceArea
  /** The assets it applies to (linked to it in Traccar). */
  assetIds: number[]
}

/** An asset arriving at or leaving a place, from Traccar's events or seen live. */
export type PlaceVisit = { assetId: number; placeId: number; arrived: boolean; time: string }

/** The radii a circle can have, in metres: small enough for a garden, though GPS fixes wander 15–25 m. */
export const PLACE_RADII = [50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000]

// Traccar's areas are WKT, latitude first: `CIRCLE (lat lon, radius)` (radius in metres, not
// standard WKT) or `POLYGON ((lat lon, lat lon, ...))`, without holes. Other shapes (LINESTRING
// corridors) aren't places panopticon shows.

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`
const CIRCLE = new RegExp(String.raw`^\s*CIRCLE\s*\(\s*${NUMBER}\s+${NUMBER}\s*,\s*${NUMBER}\s*\)\s*$`, 'i')
const POLYGON = /^\s*POLYGON\s*\(\s*\(([^()]*)\)\s*\)\s*$/i

/** The area a geofence's WKT describes, or null when it isn't a circle or a simple polygon. */
export function parseArea(wkt: string): PlaceArea | null {
  const circle = CIRCLE.exec(wkt)
  if (circle) {
    const center = { lat: Number(circle[1]), lon: Number(circle[2]) }
    const radius = Number(circle[3])
    return validLatLon(center) && radius > 0 ? { kind: 'circle', center, radius } : null
  }
  const polygon = POLYGON.exec(wkt)
  if (polygon) {
    const ring: LatLon[] = []
    for (const pair of polygon[1]!.split(',')) {
      const [lat, lon, ...rest] = pair.trim().split(/\s+/).map(Number)
      if (lat === undefined || lon === undefined || rest.length > 0) return null
      const point = { lat, lon }
      if (!validLatLon(point)) return null
      ring.push(point)
    }
    return ring.length >= 3 ? { kind: 'polygon', ring } : null
  }
  return null
}

/** A circle as Traccar's WKT, to 6 decimals (about 10 cm) and whole metres. */
export function circleWkt(center: LatLon, radius: number): string {
  return `CIRCLE (${center.lat.toFixed(6)} ${center.lon.toFixed(6)}, ${Math.round(radius)})`
}

function validLatLon({ lat, lon }: LatLon): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

/** The middle of a place, for its label and for showing it on the map. */
export function placeCenter(area: PlaceArea): LatLon {
  if (area.kind === 'circle') return area.center
  const lats = area.ring.map((point) => point.lat)
  const lons = area.ring.map((point) => point.lon)
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 }
}

/** The arrivals and departures that a change of an asset's places means: one per place left or entered. */
export function visitsBetween(assetId: number, before: number[], after: number[], time: string): PlaceVisit[] {
  return [
    ...before.filter((id) => !after.includes(id)).map((placeId) => ({ assetId, placeId, arrived: false, time })),
    ...after.filter((id) => !before.includes(id)).map((placeId) => ({ assetId, placeId, arrived: true, time })),
  ]
}

/** "Betty arrived at Home", "Betty left Home". */
export function visitSentence(assetName: string, visit: Pick<PlaceVisit, 'arrived'>, placeName: string): string {
  return `${assetName} ${visit.arrived ? 'arrived at' : 'left'} ${placeName}`
}

/** "Arrived at Home", "Left Home". */
export function visitLabel(visit: Pick<PlaceVisit, 'arrived'>, placeName: string): string {
  return visit.arrived ? `Arrived at ${placeName}` : `Left ${placeName}`
}

/** "50 m", "1.5 km". */
export function radiusLabel(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} km`
}
