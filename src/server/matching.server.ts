import type { MatchablePoint } from '../lib/matching'
import type { LatLon } from '../lib/segments'
import { distance } from '../lib/segments'
import { drawWalk, routeFits, STRAY_NEAR_WAY_METERS, strayCandidates, type DrawnWalk, type Point } from '../lib/snap'
import { env } from './env.server'

// Snaps walks to streets and paths with Valhalla's map matching (`trace_route`, pedestrian costing),
// at MAP_MATCHING_URL. Only this server talks to it; trail points never leave your own machines.
// The matched line is kept only where the fixes lie along it, and the walk is drawn as recorded
// elsewhere, such as a dog running about on the grass (`drawWalk`, lib/snap.ts), and a fix or two that
// jumped onto a way the line doesn't take are left out (`locate`). Legs nobody saw (from a stay to the
// first fix, across long gaps) follow Valhalla's walking route (`route`).

const TIMEOUT_MS = 5_000
/** Snapped walks are kept in memory; a walk that grows gets a new key. */
const MAX_CACHED = 500

const cache = new Map<string, LatLon[] | null>()

/**
 * The walk snapped to the street network where it went along it, with the legs nobody saw routed, or
 * null when Valhalla can't or none of it fits.
 */
export async function matchWalk(points: MatchablePoint[]): Promise<LatLon[] | null> {
  const url = env().mapMatchingUrl
  if (!url) return null
  const key = points
    .map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}${point.park ? 'p' : ''}${point.anchor ? 'a' : ''}`)
    .join(';')
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
        // A dog's tracker: fixes 20–30 m off are common (tried on a real walk, 2026-10-14).
        trace_options: { search_radius: 60, gps_accuracy: 25, breakage_distance: 2000 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) {
      // Where the trace breaks (a stretch it can't match), Valhalla answers with several trips: the
      // first in `trip`, the rest in `alternates`, each saying which points it covers. All of them,
      // in order, are the walk.
      type Trip = { legs?: { shape?: string }[]; locations?: { original_index?: number }[] }
      const body = (await response.json()) as { trip?: Trip; alternates?: { trip?: Trip }[] }
      const trips = [body.trip, ...(body.alternates ?? []).map((alternate) => alternate.trip)].filter((trip): trip is Trip => !!trip)
      const firstPoint = (trip: Trip) => trip.locations?.[0]?.original_index ?? 0
      const line = trips
        .sort((a, b) => firstPoint(a) - firstPoint(b))
        .flatMap((trip) => (trip.legs ?? []).flatMap((leg) => (leg.shape ? decodePolyline6(leg.shape) : [])))
      result = await routeUnseen(url, drawWalk(points, line, await strays(url, points, line)))
    } else if (response.status === 400) {
      // No match (e.g. points far from any path): the legs nobody saw may still have a route.
      result = await routeUnseen(url, drawWalk(points, []))
    } else {
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

/** The fixes that strayed (see strayCandidates in snap.ts): groups whose every fix is near a way, by `locate`. */
async function strays(url: string, points: MatchablePoint[], line: LatLon[]): Promise<Set<number>> {
  const groups = strayCandidates(points, line)
  const candidates = groups.flat()
  if (candidates.length === 0) return new Set()
  const response = await fetch(`${url}/locate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: candidates.map((index) => ({ lat: points[index]!.lat, lon: points[index]!.lon })),
      costing: 'pedestrian',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) return new Set()
  type Located = { edges?: { correlated_lat: number; correlated_lon: number }[] | null }
  const located = (await response.json()) as Located[]
  const nearWay = new Set(
    candidates.filter((index, k) =>
      (located[k]?.edges ?? []).some(
        (edge) => distance(points[index]!, { lat: edge.correlated_lat, lon: edge.correlated_lon }) <= STRAY_NEAR_WAY_METERS,
      ),
    ),
  )
  return new Set(groups.filter((group) => group.every((index) => nearWay.has(index))).flat())
}

/**
 * The walk as drawn with its legs nobody saw along Valhalla's walking route where one fits (see
 * drawWalk). Null when nothing was snapped or routed: it's drawn as recorded.
 */
async function routeUnseen(url: string, walk: DrawnWalk): Promise<LatLon[] | null> {
  const routes = await Promise.all(walk.unseen.map((k) => walkingRoute(url, walk.points[k]!, walk.points[k + 1]!)))
  if (!walk.snapped && routes.every((route) => route === null)) return null
  const result: LatLon[] = []
  walk.points.forEach((point, k) => {
    result.push({ lat: point.lat, lon: point.lon })
    const route = routes[walk.unseen.indexOf(k)]
    if (route) result.push(...route)
  })
  return result
}

/** Valhalla's walking route between two points, if it fits a leg nobody saw (see routeFits in snap.ts). */
async function walkingRoute(url: string, from: Point, to: Point): Promise<LatLon[] | null> {
  const response = await fetch(`${url}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [from, to].map(({ lat, lon }) => ({ lat, lon })), costing: 'pedestrian' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // 400: no route (e.g. a point far from any path).
  if (!response.ok) return null
  const body = (await response.json()) as { trip?: { summary?: { length?: number }; legs?: { shape?: string }[] } }
  const metres = (body.trip?.summary?.length ?? Infinity) * 1000
  const shape = body.trip?.legs?.[0]?.shape
  return shape && routeFits(from, to, metres) ? decodePolyline6(shape) : null
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
