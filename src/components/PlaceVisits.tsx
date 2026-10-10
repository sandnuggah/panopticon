import { useEffect, useState } from 'react'
import { formatTime } from '../lib/share'
import { visitLabel, type Place, type PlaceVisit } from '../lib/places'
import { useNow } from '../lib/useNow'
import { getPlaceVisits } from '../server/places.functions'

/** How many arrivals and departures the details card lists. */
const SHOWN = 5

type Props = {
  assetId: number
  /** The user's places, for their names. */
  places: Place[]
  /** The places the asset is in now: when they change, there's a new arrival or departure to fetch. */
  placeIds: number[]
}

/** An asset's latest arrivals at and departures from its places, from Traccar's events. */
export function PlaceVisits({ assetId, places, placeIds }: Props) {
  const now = useNow(60_000)
  const [visits, setVisits] = useState<PlaceVisit[]>()
  const [failed, setFailed] = useState(false)
  const placesKey = placeIds.join(',')

  useEffect(() => {
    let cancelled = false
    getPlaceVisits({ data: assetId })
      .then((result) => {
        if (cancelled) return
        setVisits(result)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [assetId, placesKey])

  // Visits to places since removed have no name to show.
  const named = (visits ?? []).flatMap((visit) => {
    const place = places.find((candidate) => candidate.id === visit.placeId)
    return place ? [{ ...visit, label: visitLabel(visit, place.name) }] : []
  })

  return (
    <section className="pt-4" aria-label="Arrivals and departures">
      <h3 className="pb-1 text-sm font-semibold opacity-60">Arrivals and departures</h3>
      {failed ? (
        <p className="opacity-60">Couldn't load them from Traccar.</p>
      ) : !visits ? (
        <p className="opacity-60">Loading…</p>
      ) : named.length === 0 ? (
        <p className="opacity-60">None in the last week.</p>
      ) : (
        <ul>
          {named.slice(0, SHOWN).map((visit) => (
            <li key={`${visit.time}-${visit.placeId}-${visit.arrived}`} className="flex flex-wrap justify-between gap-x-3 py-0.5">
              <span>{visit.label}</span>
              <span className="opacity-60">{formatTime(Date.parse(visit.time), now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
