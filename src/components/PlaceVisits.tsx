import { useEffect, useState } from 'react'
import { formatTime } from '../lib/share'
import { durationLabel, visitRows, type Place, type PlaceVisit } from '../lib/places'
import { ArrivedIcon, OutIcon } from './icons'
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

/**
 * An asset's latest arrivals at and departures from its places, from Traccar's events: an arrival
 * as the place with an arrow going in, a departure as how long it was out until it arrived somewhere
 * again (or so far), with a winding route. Screen readers hear "Arrived at Home", "Left Home, out 49 min".
 */
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

  // Visits to places since removed have no name to show (an arrival there still ends a trip out).
  const named = visitRows(visits ?? []).flatMap((row) => {
    const place = places.find((candidate) => candidate.id === row.placeId)
    return place ? [{ ...row, placeName: place.name }] : []
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
          {named.slice(0, SHOWN).map((row) => (
            <li key={`${row.time}-${row.placeId}-${row.kind}`} className="flex items-center gap-x-2.5 py-0.5">
              {row.kind === 'arrived' ? (
                <>
                  <span className="shrink-0 text-primary">
                    <ArrivedIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Arrived at </span>
                    {row.placeName}
                  </span>
                </>
              ) : (
                <>
                  <span className="shrink-0 text-[var(--offline)]">
                    <OutIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Left {row.placeName}, </span>
                    {row.until === null
                      ? `Out ${durationLabel(now - Date.parse(row.time))} so far`
                      : `Out ${durationLabel(Date.parse(row.until) - Date.parse(row.time))}`}
                  </span>
                </>
              )}
              <span className="shrink-0 opacity-60">{formatTime(Date.parse(row.time), now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
