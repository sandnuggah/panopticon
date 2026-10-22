// Parks, for Snap to paths: inside a park a dog runs about on the grass, near paths it isn't on, so
// walks there are snapped only where the fixes keep close to a path (lib/snap.ts). The areas come
// from the map's own tiles (AssetMap), so nothing extra is fetched. No runtime imports, so Node can
// run the tests directly.

export type ParkPoint = { lat: number; lon: number }

/** A park's outline and its holes, as rings of points; with its bounding box, to rule most points out fast. */
export type Park = { rings: ParkPoint[][]; south: number; west: number; north: number; east: number }

/** A park from GeoJSON-style rings ([lon, lat] pairs): the first the outline, the rest holes. */
export function parkFromRings(rings: [number, number][][]): Park | null {
  const outline = rings[0]
  if (!outline || outline.length < 3) return null
  const points = rings.map((ring) => ring.map(([lon, lat]) => ({ lat, lon })))
  const lats = points[0]!.map((point) => point.lat)
  const lons = points[0]!.map((point) => point.lon)
  return { rings: points, south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) }
}

/** Whether these are the same parks (by their bounds, in any order), as the map tells of them again after a move. */
export function sameParks(a: Park[], b: Park[]): boolean {
  const key = (parks: Park[]) =>
    parks
      .map((park) => `${park.south},${park.west},${park.north},${park.east}`)
      .sort()
      .join(';')
  return a.length === b.length && key(a) === key(b)
}

/** Whether a point is in any of the parks: inside an outline and not in one of its holes. */
export function isInPark(point: ParkPoint, parks: Park[]): boolean {
  return parks.some(
    (park) =>
      point.lat >= park.south &&
      point.lat <= park.north &&
      point.lon >= park.west &&
      point.lon <= park.east &&
      inRing(point, park.rings[0]!) &&
      !park.rings.slice(1).some((hole) => inRing(point, hole)),
  )
}

function inRing(point: ParkPoint, ring: ParkPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i]!, ring[j]!]
    if (a.lat > point.lat !== b.lat > point.lat && point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside
    }
  }
  return inside
}
