import { useEffect, useState } from 'react'
import { getAddress } from '../server/map.functions'
import type { Asset } from './asset'
import { distance, type LatLon } from './segments'

/** Only looked up again once the asset has moved this far from where its address was found. */
const MOVED_METERS = 25

type Found = LatLon & { assetId: number; address: string | null }

/**
 * The street address where this asset is, from Traccar's reverse geocoder (see address.server.ts).
 * Undefined until known, and when there's no address or geocoding is off.
 */
export function useAddress(asset: Asset | undefined): string | undefined {
  const [found, setFound] = useState<Found>()
  const id = asset?.id
  const location = asset?.location
  const current = found && found.assetId === id && location && distance(found, location) <= MOVED_METERS
  const lookUp = id !== undefined && location && !current ? { id, lat: location.lat, lon: location.lon } : null

  useEffect(() => {
    if (!lookUp) return
    let cancelled = false
    getAddress({ data: { lat: lookUp.lat, lon: lookUp.lon } })
      .then((address) => {
        if (!cancelled) setFound({ assetId: lookUp.id, lat: lookUp.lat, lon: lookUp.lon, address })
      })
      .catch(() => {
        // Unreachable or signed out: no address, and another try when the asset moves or is reselected.
        if (!cancelled) setFound(undefined)
      })
    return () => {
      cancelled = true
    }
    // Asks again only when the lookup's inputs change: another asset, or it moved on.
  }, [lookUp?.id, lookUp?.lat, lookUp?.lon])

  // While walking on, the last address shows until the next one arrives.
  return found && found.assetId === id ? (found.address ?? undefined) : undefined
}
