import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getUser } from '../server/auth.functions'
import { getTrails } from '../server/trails.functions'
import type { Asset } from './asset'
import { BUILD_ID } from './buildId'
import { applyUpdates, type LiveUpdate } from './live'
import { placeAt, placeCenter, trailPlaces, type Place, type PlaceVisit } from './places'
import { confirmedLocation, currentActivity, currentStay, type Activity, type Stay } from './segments'
import { trackersOf, trailProfile } from './tracker'
import { HISTORY_MIN_MINUTES, extendTrails, pruneTrails, trailMinutes, trailStart, type TrailLength, type Trails } from './trail'
import { useNow } from './useNow'

export type LiveStatus = 'connecting' | 'live' | 'offline'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000

/**
 * Keeps the asset list and trails current from /live. `initialAssets` is the route loader's data;
 * whenever it's reloaded (reconnect, returning to the tab) it replaces the live state.
 * `trail` is null until the setting is known, so no history is fetched for a default.
 * History always covers at least HISTORY_MIN_MINUTES, even with trails off, to tell what each asset
 * is doing right now; only the trail's own length of it is returned for drawing.
 * `onVisits` hears of arrivals and departures as live positions show them.
 */
export function useLiveAssets(
  initialAssets: Asset[],
  trail: TrailLength | null,
  places: Place[],
  onVisits?: (visits: PlaceVisit[]) => void,
) {
  const historyMinutes = Math.max(trailMinutes(trail ?? 0), HISTORY_MIN_MINUTES)
  const router = useRouter()
  const [assets, setAssets] = useState(initialAssets)
  const assetsRef = useRef(initialAssets)
  const [trails, setTrails] = useState<Trails>({})
  // Whether the first trail history has come back (or failed), for the loading screen.
  const [trailsLoaded, setTrailsLoaded] = useState(false)
  const [status, setStatus] = useState<LiveStatus>('connecting')
  // A newer release is serving than the one this page came from (see buildId.ts).
  const [updateAvailable, setUpdateAvailable] = useState(false)
  // Bumped when we may have missed updates, to refetch trail history.
  const [historyVersion, setHistoryVersion] = useState(0)
  const historyMinutesRef = useRef(historyMinutes)
  const now = useNow(15_000)
  const onVisitsRef = useRef(onVisits)

  useEffect(() => {
    historyMinutesRef.current = historyMinutes
    onVisitsRef.current = onVisits
  })

  useEffect(() => {
    assetsRef.current = initialAssets
    setAssets(initialAssets)
  }, [initialAssets])

  const assetIdsKey = initialAssets.map((asset) => asset.id).join(',')
  useEffect(() => {
    if (trail === null) return
    if (assetIdsKey === '') {
      setTrails({})
      setTrailsLoaded(true)
      return
    }
    let cancelled = false
    getTrails({ data: { minutes: historyMinutes, assetIds: assetIdsKey.split(',').map(Number) } })
      .then((history) => {
        // A failed server function can resolve with nothing (seen on a fresh dev server); keep
        // the trails we have rather than crash the map.
        if (!cancelled && history) setTrails(history)
      })
      .catch((error) => console.warn('Could not load trails:', error))
      .finally(() => {
        if (!cancelled) setTrailsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [trail === null, historyMinutes, assetIdsKey, historyVersion])

  useEffect(() => {
    let source: EventSource | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryDelay = FIRST_RETRY_MS
    let reconnecting = false

    const refresh = () => {
      void router.invalidate()
      setHistoryVersion((version) => version + 1)
    }

    const onUpdates = (updates: LiveUpdate[]) => {
      const result = applyUpdates(assetsRef.current, updates)
      assetsRef.current = result.assets
      setAssets(result.assets)
      // A tracker was added in Traccar; reload the full list.
      if (result.unknown) void router.invalidate()
      if (result.visits.length > 0) onVisitsRef.current?.(result.visits)
      const since = Date.now() - historyMinutesRef.current * 60 * 1000
      setTrails((current) => extendTrails(current, updates, since))
    }

    const connect = () => {
      setStatus('connecting')
      source = new EventSource('/live')
      source.onopen = () => {
        setStatus('live')
        retryDelay = FIRST_RETRY_MS
        // After a gap, fetch what we missed. The first open needs nothing: the loader just ran.
        if (reconnecting) refresh()
        reconnecting = true
      }
      source.addEventListener('version', (event) => {
        if ((event as MessageEvent<string>).data !== BUILD_ID) setUpdateAvailable(true)
      })
      source.onmessage = (event) => {
        try {
          onUpdates(JSON.parse(event.data) as LiveUpdate[])
        } catch (error) {
          console.warn('Ignoring live message:', error)
        }
      }
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) {
          // The stream ended; the browser reconnects by itself.
          setStatus('connecting')
          return
        }
        // Refused, so the browser gives up. Signed out: go to /login. Otherwise Traccar is
        // unreachable: keep showing what we have and retry with backoff.
        setStatus('offline')
        reconnecting = true
        getUser()
          .then((user) => {
            if (!user) void router.navigate({ to: '/login' })
          })
          .catch(() => {})
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
      }
    }

    // Phones suspend background tabs and their connections; start fresh when we're visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      source?.close()
      clearTimeout(retryTimer)
      reconnecting = false
      refresh()
      connect()
    }

    connect()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(retryTimer)
      source?.close()
    }
  }, [router])

  const visibleTrails = useMemo(() => {
    const start = trailStart(trail ?? 0, now)
    return start === null ? {} : pruneTrails(trails, start)
  }, [trails, trail, now])

  // Read as each asset's kind of tracker reports.
  const trackerKey = assets.map((asset) => `${asset.id}:${asset.tracker ?? ''}`).join(' ')
  const trackers = useMemo(() => trackersOf(assets), [trackerKey])

  const activities = useMemo(() => {
    const result: Record<number, Activity> = {}
    for (const [id, points] of Object.entries(trails)) {
      const activity = currentActivity(points, now, trailProfile(trackers[Number(id)]))
      if (activity) result[Number(id)] = activity
    }
    return result
  }, [trails, now, trackers])

  const stays = useMemo(() => {
    const result: Record<number, Stay> = {}
    for (const [id, points] of Object.entries(trails)) {
      const stay = currentStay(points, now, trailProfile(trackers[Number(id)]), trailPlaces(places, Number(id)))
      if (stay) result[Number(id)] = stay
    }
    return result
  }, [trails, now, trackers, places])

  // Each asset where its trail can trust it to be: at its latest fix, unless GPS has yet to confirm
  // that one (see lastConfirmedFix); and at one of its places, at the place's centre, so it sits still
  // there however its fixes wander indoors. With when it last reported all the same.
  const shownAssets = useMemo(
    () =>
      assets.map((asset) => {
        if (!asset.location) return asset
        const points = trails[asset.id]
        let location = points ? confirmedLocation(asset.location, points, trailProfile(asset.tracker)) : asset.location
        const place = placeAt(places, asset.id, location)
        if (place) location = { ...location, ...placeCenter(place.area), accuracy: undefined }
        return location === asset.location ? asset : { ...asset, location }
      }),
    [assets, trails, places],
  )

  return { assets: shownAssets, trails: visibleTrails, trailsLoaded, activities, stays, status, updateAvailable }
}
