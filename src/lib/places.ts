import { distance, type LatLon, type TrailPlace } from './segments.ts'

// Places: areas like Home or Daycare, kept in Traccar as geofences (see places.server.ts). Traccar
// works out which of an asset's places each position is inside (`geofenceIds`), and records arriving
// and leaving as events. No runtime imports beyond segments.ts, so Node can run the tests directly.

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

/** An asset's places as its trail uses them: stays in them are drawn as one dot at the place's middle (see segments.ts). */
export function trailPlaces(places: Place[], assetId: number): TrailPlace[] {
  return places
    .filter((place) => place.assetIds.includes(assetId))
    .map(({ area }) => ({ center: placeCenter(area), within: (point, margin) => withinArea(area, point, margin) }))
}

/** Whether a point is inside the area, or at most `margin` metres outside it. */
export function withinArea(area: PlaceArea, point: LatLon, margin: number): boolean {
  if (area.kind === 'circle') return distance(area.center, point) <= area.radius + margin
  if (inRing(point, area.ring)) return true
  return margin > 0 && area.ring.some((a, index) => metresToSegment(point, a, area.ring[(index + 1) % area.ring.length]!) <= margin)
}

function inRing(point: LatLon, ring: LatLon[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i]!, ring[j]!]
    if (a.lat > point.lat !== b.lat > point.lat && point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside
    }
  }
  return inside
}

/** How far a point is from the segment a–b, in metres (flat: places are small). */
function metresToSegment(point: LatLon, a: LatLon, b: LatLon): number {
  const metresPerDegreeLon = Math.cos((point.lat * Math.PI) / 180) * 111_320
  const xy = (q: LatLon) => [(q.lon - point.lon) * metresPerDegreeLon, (q.lat - point.lat) * 110_540] as const
  const [ax, ay] = xy(a)
  const [bx, by] = xy(b)
  const [dx, dy] = [bx - ax, by - ay]
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
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

/**
 * An asset's arrivals and departures as the details card lists them, newest first: arriving at a
 * place, or being out. A departure is how long the asset was out, until its next arrival anywhere,
 * or still out (`until` null).
 */
export type VisitRow =
  { kind: 'arrived'; placeId: number; time: string } | { kind: 'out'; placeId: number; time: string; until: string | null }

/** Arrivals and departures, newest first, as rows: each departure with the arrival that ended it. */
export function visitRows(visits: Pick<PlaceVisit, 'placeId' | 'arrived' | 'time'>[]): VisitRow[] {
  return visits.map((visit, index) => {
    if (visit.arrived) return { kind: 'arrived', placeId: visit.placeId, time: visit.time }
    // The arrival just after it: the nearest arrival above it in the list.
    const next = visits.slice(0, index).findLast((other) => other.arrived)
    return { kind: 'out', placeId: visit.placeId, time: visit.time, until: next?.time ?? null }
  })
}

/** How long, briefly: "49 min", "2 h 5 min", "1 d 3 h". At least a minute. */
export function durationLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`
}

/** "50 m", "1.5 km". */
export function radiusLabel(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} km`
}
