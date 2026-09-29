import { useEffect, useRef, useState } from 'react'
import { getAddress } from '../server/map.functions'
import type { Asset } from './asset'
import { distance, type LatLon } from './segments'

/** Only looked up again once the asset has moved this far from where its address was found. */
const MOVED_METERS = 25

type Found = LatLon & { assetId: number; address: string | null }

type LookUp = (lat: number, lon: number) => Promise<string | null>

const signedIn: LookUp = (lat, lon) => getAddress({ data: { lat, lon } })

/**
 * The street address where this asset is, from Traccar's reverse geocoder (see address.server.ts).
 * Undefined until known, and when there's no address or geocoding is off. `lookUp` is how to ask;
 * a live location link page asks with its link instead of a session.
 */
export function useAddress(asset: Asset | undefined, lookUp: LookUp = signedIn): string | undefined {
  const [found, setFound] = useState<Found>()
  const lookUpRef = useRef(lookUp)
  lookUpRef.current = lookUp
  const id = asset?.id
  const location = asset?.location
  const current = found && found.assetId === id && location && distance(found, location) <= MOVED_METERS
  const wanted = id !== undefined && location && !current ? { id, lat: location.lat, lon: location.lon } : null

  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    lookUpRef
      .current(wanted.lat, wanted.lon)
      .then((address) => {
        if (!cancelled) setFound({ assetId: wanted.id, lat: wanted.lat, lon: wanted.lon, address })
      })
      .catch(() => {
        // Unreachable or signed out: no address, and another try when the asset moves or is reselected.
        if (!cancelled) setFound(undefined)
      })
    return () => {
      cancelled = true
    }
    // Asks again only when the lookup's inputs change: another asset, or it moved on.
  }, [wanted?.id, wanted?.lat, wanted?.lon])

  // While walking on, the last address shows until the next one arrives.
  return found && found.assetId === id ? (found.address ?? undefined) : undefined
}
