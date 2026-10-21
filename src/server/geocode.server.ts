import type { LatLon } from '../lib/segments'
import { env } from './env.server'

// Finding a place by its address, for the place editor: a Nominatim server's search (GEOCODER_URL),
// your own or a public one whose terms allow it. Only this server asks it, and only for what's typed
// into the editor's search; nothing about where your assets are.

const TIMEOUT_MS = 5_000
const MAX_RESULTS = 5
/** Results near the map come first: within this many degrees each way. */
const NEAR_DEGREES = 0.5

export type FoundAddress = { label: string; point: LatLon }

/** Addresses matching `query`, those near `near` first; none when there's no geocoder or it fails. */
export async function searchAddress(query: string, near: LatLon | null): Promise<FoundAddress[]> {
  const url = env().geocoderUrl
  if (!url) return []
  const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: String(MAX_RESULTS) })
  if (near) {
    const box = [near.lon - NEAR_DEGREES, near.lat + NEAR_DEGREES, near.lon + NEAR_DEGREES, near.lat - NEAR_DEGREES]
    params.set('viewbox', box.join(','))
  }
  try {
    const response = await fetch(`${url}/search?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'panopticon' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(`Address search failed with HTTP ${response.status}`)
      return []
    }
    type Result = { lat?: string; lon?: string; display_name?: string; address?: Record<string, string> }
    const results = (await response.json()) as Result[]
    return results.flatMap((result) => {
      const point = { lat: Number(result.lat), lon: Number(result.lon) }
      const label = addressLabel(result)
      return Number.isFinite(point.lat) && Number.isFinite(point.lon) && label ? [{ label, point }] : []
    })
  } catch (error) {
    console.warn('Address search unavailable:', error instanceof Error ? error.message : error)
    return []
  }
}

/** "Bohusgatan 12, 116 67 Stockholm": street and number, then postcode and town; else Nominatim's own name. */
function addressLabel(result: { display_name?: string; address?: Record<string, string> }): string {
  const address = result.address ?? {}
  const street = [address.road ?? address.pedestrian ?? address.footway, address.house_number].filter(Boolean).join(' ')
  const town = [address.postcode, address.city ?? address.town ?? address.village ?? address.municipality].filter(Boolean).join(' ')
  return street ? [street, town].filter(Boolean).join(', ') : (result.display_name ?? '')
}
