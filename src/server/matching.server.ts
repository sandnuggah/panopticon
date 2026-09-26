import type { MatchablePoint } from '../lib/matching'
import type { LatLon } from '../lib/segments'
import { env } from './env.server'

// Snaps walks to streets and paths with Valhalla's map matching (`trace_route`, pedestrian costing),
// at MAP_MATCHING_URL. Only this server talks to it; trail points never leave your own machines.
// A snapped line is used only when the real points are typically close to it: settings tuned on a
// real walk across Stockholm, where the first fix after coming out of the metro was 38 m off.

/** On average the real points must lie within this of the snapped line... */
const MEAN_DEVIATION_METERS = 15
/** ...and 90% of them within this, so one bad fix doesn't sink a whole walk. */
const P90_DEVIATION_METERS = 30
const TIMEOUT_MS = 5_000
/** Snapped walks are kept in memory; a walk that grows gets a new key. */
const MAX_CACHED = 500

const cache = new Map<string, LatLon[] | null>()

/** The walk snapped to the street network, or null when Valhalla can't or the result isn't close enough. */
export async function matchWalk(points: MatchablePoint[]): Promise<LatLon[] | null> {
  const url = env().mapMatchingUrl
  if (!url) return null
  const key = points.map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`).join(';')
  if (cache.has(key)) return cache.get(key)!

  let result: LatLon[] | null = null
  try {
    const response = await fetch(`${url}/trace_route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shape: points.map((point) => ({ lat: point.lat, lon: point.lon, time: Math.round(point.time / 1000) })),
        costing: 'pedestrian',
        shape_match: 'map_snap',
        trace_options: { search_radius: 50, gps_accuracy: 15, breakage_distance: 2000 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) {
      const body = (await response.json()) as { trip?: { legs?: { shape?: string }[] } }
      const line = (body.trip?.legs ?? []).flatMap((leg) => (leg.shape ? decodePolyline6(leg.shape) : []))
      if (line.length >= 2 && closeEnough(points, line)) result = line
    } else if (response.status !== 400) {
      // 400 means Valhalla found no match (e.g. points far from any path); anything else is worth a log line.
      console.warn(`Map matching failed with HTTP ${response.status}`)
    }
  } catch (error) {
    console.warn('Map matching unavailable:', error instanceof Error ? error.message : error)
    return null // not cached: try again next time
  }

  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

function closeEnough(points: LatLon[], line: LatLon[]): boolean {
  const deviations = points.map((point) => distanceToLine(point, line)).sort((a, b) => a - b)
  const mean = deviations.reduce((sum, d) => sum + d, 0) / deviations.length
  const p90 = deviations[Math.ceil(deviations.length * 0.9) - 1]!
  return mean <= MEAN_DEVIATION_METERS && p90 <= P90_DEVIATION_METERS
}

/** Metres from a point to a polyline; a flat approximation, fine at city scale. */
function distanceToLine(point: LatLon, line: LatLon[]): number {
  const metresPerDegreeLon = Math.cos((point.lat * Math.PI) / 180) * 111_320
  const xy = (q: LatLon) => [(q.lon - point.lon) * metresPerDegreeLon, (q.lat - point.lat) * 110_540] as const
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]!)
    const [bx, by] = xy(line[i]!)
    const [dx, dy] = [bx - ax, by - ay]
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** Valhalla's shapes are Google-style encoded polylines with 6 decimals. */
function decodePolyline6(encoded: string): LatLon[] {
  const points: LatLon[] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0
      let result = 0
      let byte: number
      do {
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (axis === 0) lat += delta
      else lon += delta
    }
    points.push({ lat: lat / 1e6, lon: lon / 1e6 })
  }
  return points
}
