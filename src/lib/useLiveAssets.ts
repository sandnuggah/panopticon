import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getUser } from '../server/auth.functions'
import { getTrails } from '../server/trails.functions'
import type { Asset } from './asset'
import { BUILD_ID } from './buildId'
import { applyUpdates, type LiveUpdate } from './live'
import { shownLocation, trailPlaces, type Place, type PlaceVisit } from './places'
import { currentActivity, currentStay, type Activity, type Stay } from './segments'
import { trackersOf, trailProfile, type TrackerKind } from './tracker'
import { extendTrails, historyMinutes, stayPoints, trailStart, type TrailLength, type TrailPoint, type Trails } from './trail'
import { firstShown, trailFrom, trailView, type TrailView, type TrailViews } from './trailGeometry'
import { useNow } from './useNow'

export type LiveStatus = 'connecting' | 'live' | 'offline'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000

/**
 * Keeps the asset list and trails current from /live. `initialAssets` is the route loader's data;
 * whenever it's reloaded (reconnect, returning to the tab) it replaces the live state.
 * `trail` is null until the setting is known, so no history is fetched for a default.
 * History covers the trail and HISTORY_MIN_MINUTES before it (see historyMinutes), even with trails
 * off, to tell what each asset is doing right now; the trails are worked out from all of it and
 * returned for drawing from where the trail starts (see trailFrom).
 * `onVisits` hears of arrivals and departures as live positions show them.
 */
export function useLiveAssets(
  initialAssets: Asset[],
  trail: TrailLength | null,
  places: Place[],
  onVisits?: (visits: PlaceVisit[]) => void,
) {
  const historyLength = historyMinutes(trail ?? 0)
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
  const historyLengthRef = useRef(historyLength)
  const now = useNow(15_000)
  const onVisitsRef = useRef(onVisits)

  useEffect(() => {
    historyLengthRef.current = historyLength
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
    getTrails({ data: { minutes: historyLength, assetIds: assetIdsKey.split(',').map(Number) } })
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
  }, [trail === null, historyLength, assetIdsKey, historyVersion])

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
      const since = Date.now() - historyLengthRef.current * 60 * 1000
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

  // Read as each asset's kind of tracker reports.
  const trackerKey = assets.map((asset) => `${asset.id}:${asset.tracker ?? ''}`).join(' ')
  const trackers = useMemo(() => trackersOf(assets), [trackerKey])

  // Each asset's trail, worked out from all of its points as they come, not as the clock ticks (see
  // trailView); only an asset whose points changed is worked out again.
  const worked = useRef(
    new Map<number, { points: TrailPoint[]; places: Place[]; tracker: TrackerKind | undefined; view: TrailView | null }>(),
  )
  const views = useMemo(() => {
    const result: TrailViews = {}
    for (const [key, points] of Object.entries(trails)) {
      const id = Number(key)
      let entry = worked.current.get(id)
      if (entry?.points !== points || entry.places !== places || entry.tracker !== trackers[id]) {
        entry = { points, places, tracker: trackers[id], view: trailView(points, places, id, trackers[id]) }
        worked.current.set(id, entry)
      }
      if (entry.view) result[id] = entry.view
    }
    return result
  }, [trails, places, trackers])

  // Drawn from where the trail starts: the same until a whole piece drops off its old end (see firstShown).
  const start = trailStart(trail ?? 0, now)
  const firsts = Object.entries(views).map(
    ([id, view]) => [Number(id), start === null ? Infinity : firstShown(view.pieces, start)] as const,
  )
  const firstsKey = firsts.map(([id, first]) => `${id}:${first}`).join(' ')
  const shownTrails = useMemo(() => {
    const result: TrailViews = {}
    for (const [id, first] of firsts) {
      const shown = trailFrom(views[id]!, first)
      if (shown) result[id] = shown
    }
    return result
  }, [views, firstsKey])

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
      const stay = currentStay(stayPoints(points, trail ?? 0), now, trailProfile(trackers[Number(id)]), trailPlaces(places, Number(id)))
      if (stay) result[Number(id)] = stay
    }
    return result
  }, [trails, trail, now, trackers, places])

  // Each asset where its trail can trust it to be, and at its place's centre when it's at one (see shownLocation).
  const shownAssets = useMemo(
    () =>
      assets.map((asset) => {
        if (!asset.location) return asset
        const location = shownLocation(places, asset.id, asset.location, trails[asset.id], trailProfile(asset.tracker))
        return location === asset.location ? asset : { ...asset, location }
      }),
    [assets, trails, places],
  )

  return { assets: shownAssets, trails: shownTrails, trailsLoaded, activities, stays, status, updateAvailable }
}
