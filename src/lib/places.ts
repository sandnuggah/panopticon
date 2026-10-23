import { distance, type LatLon } from './segments.ts'

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
  /** Its street address, as given in the editor ("Bohusgatan 12, Stockholm"). */
  address?: string
  /**
   * Where you come and go, on a street (see wayIn.server.ts): walks to and from the place start
   * there, and its dot on the trail is drawn there. Without one, the place's middle.
   */
  wayIn?: LatLon
}

// A place's address and way in are kept with its geofence in Traccar, as attributes.
export const ADDRESS_ATTRIBUTE = 'address'
export const WAY_IN_ATTRIBUTE = 'wayIn'

/** A way in as a geofence attribute: latitude first, as Traccar's areas are, to 6 decimals. */
export function wayInAttribute(point: LatLon): string {
  return `${point.lat.toFixed(6)} ${point.lon.toFixed(6)}`
}

/** A way in from a geofence attribute, or undefined when it's missing or not one. */
export function parseWayIn(value: unknown): LatLon | undefined {
  if (typeof value !== 'string') return undefined
  const match = new RegExp(String.raw`^\s*${NUMBER}\s+${NUMBER}\s*$`).exec(value)
  if (!match) return undefined
  const point = { lat: Number(match[1]), lon: Number(match[2]) }
  return validLatLon(point) ? point : undefined
}

/**
 * The street in an address, to find the way in on: its first part, without house numbers
 * ("Bohusgatan 12, 116 67 Stockholm" and "12 Main Street, Springfield" give "Bohusgatan" and "Main
 * Street"). Null when there's no street in it.
 */
export function streetOf(address: string): string | null {
  const street = (address.split(',')[0] ?? '')
    .split(/\s+/)
    .filter((word) => word && !/\d/.test(word))
    .join(' ')
  return street || null
}

/** An asset arriving at or leaving a place, from Traccar's events or seen live. */
export type PlaceVisit = { assetId: number; placeId: number; arrived: boolean; time: string }

/**
 * The radii a circle can have, in metres: 50 to 100 m in steps of 5, a home, a garden or a daycare.
 * Not smaller: GPS fixes wander 15–25 m, so the asset would come and go while it sits still.
 */
export const PLACE_RADII = Array.from({ length: 11 }, (_, index) => 50 + index * 5)

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

/** A Traccar geofence as a place, with the assets linked to it; null for an area panopticon can't show. */
export function placeOf(
  geofence: { id: number; name: string; area: string; attributes: Record<string, unknown> },
  assetIds: number[],
): Place | null {
  const area = parseArea(geofence.area)
  if (!area) return null
  const place: Place = { id: geofence.id, name: geofence.name, area, assetIds }
  const address = geofence.attributes[ADDRESS_ATTRIBUTE]
  if (typeof address === 'string' && address.trim()) place.address = address.trim()
  const wayIn = parseWayIn(geofence.attributes[WAY_IN_ATTRIBUTE])
  if (wayIn) place.wayIn = wayIn
  return place
}

/** The middle of a place, for its label and for showing it on the map. */
export function placeCenter(area: PlaceArea): LatLon {
  if (area.kind === 'circle') return area.center
  const lats = area.ring.map((point) => point.lat)
  const lons = area.ring.map((point) => point.lon)
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 }
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

/** How big an area is, in square metres (flat: places are small). */
export function areaSize(area: PlaceArea): number {
  if (area.kind === 'circle') return Math.PI * area.radius ** 2
  const origin = area.ring[0]!
  const metresPerDegreeLon = Math.cos((origin.lat * Math.PI) / 180) * 111_320
  const xy = (q: LatLon) => [(q.lon - origin.lon) * metresPerDegreeLon, (q.lat - origin.lat) * 110_540] as const
  let twice = 0
  area.ring.forEach((point, index) => {
    const [[ax, ay], [bx, by]] = [xy(point), xy(area.ring[(index + 1) % area.ring.length]!)]
    twice += ax * by - bx * ay
  })
  return Math.abs(twice) / 2
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

/** "Betty arrived at Home", "Betty left Home". */
export function visitSentence(assetName: string, visit: Pick<PlaceVisit, 'arrived'>, placeName: string): string {
  return `${assetName} ${visit.arrived ? 'arrived at' : 'left'} ${placeName}`
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
