import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getUser } from '../server/auth.functions'
import { getTrails } from '../server/trails.functions'
import type { Asset } from './asset'
import { applyUpdates, type LiveUpdate } from './live'
import type { PlaceVisit } from './places'
import { currentActivity, currentStay, type Activity, type Stay } from './segments'
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
export function useLiveAssets(initialAssets: Asset[], trail: TrailLength | null, onVisits?: (visits: PlaceVisit[]) => void) {
  const historyMinutes = Math.max(trailMinutes(trail ?? 0), HISTORY_MIN_MINUTES)
  const router = useRouter()
  const [assets, setAssets] = useState(initialAssets)
  const assetsRef = useRef(initialAssets)
  const [trails, setTrails] = useState<Trails>({})
  const [status, setStatus] = useState<LiveStatus>('connecting')
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

  const activities = useMemo(() => {
    const result: Record<number, Activity> = {}
    for (const [id, points] of Object.entries(trails)) {
      const activity = currentActivity(points, now)
      if (activity) result[Number(id)] = activity
    }
    return result
  }, [trails, now])

  const stays = useMemo(() => {
    const result: Record<number, Stay> = {}
    for (const [id, points] of Object.entries(trails)) {
      const stay = currentStay(points, now)
      if (stay) result[Number(id)] = stay
    }
    return result
  }, [trails, now])

  return { assets, trails: visibleTrails, activities, stays, status }
}
