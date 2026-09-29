import { reverseGeocode, TraccarError } from './traccar.server'

// Street addresses for the selected asset, from Traccar's own reverse geocoder, so they come from
// whichever provider Traccar is set up with (e.g. a self-hosted Nominatim). Points are rounded to
// about 10 m and the answers cached, so a dog pottering about one yard costs a lookup or two.

/** 4 decimals: about 11 m north–south, 6 m east–west in Sweden. */
const DECIMALS = 4
const MAX_CACHED = 1_000

const cache = new Map<string, string | null>()
let warned = false

/** The address near a point, or null when there's none or geocoding isn't available. */
export async function lookUpAddress(token: string, lat: number, lon: number): Promise<string | null> {
  const [roundedLat, roundedLon] = [lat, lon].map((degrees) => Number(degrees.toFixed(DECIMALS))) as [number, number]
  const key = `${roundedLat},${roundedLon}`
  if (cache.has(key)) return cache.get(key)!

  let address: string | null
  try {
    address = await reverseGeocode(token, roundedLat, roundedLon)
  } catch (error) {
    // A dead token is handled by withToken; anything else just means no address (not cached, so
    // it works as soon as geocoding does). Logged once, since it's usually "not enabled".
    if (error instanceof TraccarError && error.status === 401) throw error
    if (!warned) console.warn('No addresses:', error instanceof Error ? error.message : error)
    warned = true
    return null
  }

  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(key, address)
  return address
}
