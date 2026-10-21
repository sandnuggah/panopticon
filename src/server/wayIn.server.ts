import { streetOf } from '../lib/places'
import { distance, type LatLon } from '../lib/segments'
import { env } from './env.server'

// A place's way in: where you come and go, on its street, so walks to and from it start on the right
// one (a home on a bridge over another street, an office with its door round the back) and its dot
// on the trail is there. Valhalla's `locate` lists the ways near a point with their names; the way in
// is the nearest point on a way named as the address's street. (Its routes take a street name too,
// but ignore it.)

const TIMEOUT_MS = 5_000
/** How far from the address (or the place's middle) its street is looked for. */
const SEARCH_METERS = 150

/**
 * The way in for a place with this address, near `near`: on its street, or `fallback` (where the
 * address was found) without Valhalla or a way of that name nearby; null without either.
 */
export async function findWayIn(near: LatLon, address: string | null, fallback: LatLon | null): Promise<LatLon | null> {
  const street = address ? streetOf(address) : null
  const url = env().mapMatchingUrl
  if (!street || !url) return fallback
  try {
    const response = await fetch(`${url}/locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [{ lat: near.lat, lon: near.lon, radius: SEARCH_METERS }], costing: 'pedestrian', verbose: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return fallback
    type Edge = { correlated_lat: number; correlated_lon: number; edge_info?: { names?: string[] } }
    const [located] = (await response.json()) as { edges?: Edge[] | null }[]
    const wanted = normalised(street)
    const onStreet = (located?.edges ?? [])
      .filter((edge) => (edge.edge_info?.names ?? []).some((name) => normalised(name) === wanted))
      .map((edge) => ({ lat: edge.correlated_lat, lon: edge.correlated_lon }))
      .sort((a, b) => distance(near, a) - distance(near, b))
    return onStreet[0] ?? fallback
  } catch (error) {
    console.warn('No way in:', error instanceof Error ? error.message : error)
    return fallback
  }
}

function normalised(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase().trim()
}
