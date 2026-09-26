import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getUser } from '../server/auth.functions'
import { getTrails } from '../server/trails.functions'
import type { Asset } from './asset'
import { applyUpdates, type LiveUpdate } from './live'
import { currentActivity, type Activity } from './segments'
import { ACTIVITY_MINUTES, extendTrails, pruneTrails, type Trails } from './trail'
import { useNow } from './useNow'

export type LiveStatus = 'connecting' | 'live' | 'offline'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000

/**
 * Keeps the asset list and trails current from /live. `initialAssets` is the route loader's data;
 * whenever it's reloaded (reconnect, returning to the tab) it replaces the live state.
 * `trailMinutes` is null until the setting is known, so no history is fetched for a default.
 * History always covers at least ACTIVITY_MINUTES, even with trails off, to tell what each asset
 * is doing right now; only `trailMinutes` of it is returned for drawing.
 */
export function useLiveAssets(initialAssets: Asset[], trailMinutesSetting: number | null) {
  const trailMinutes = trailMinutesSetting ?? 0
  const historyMinutes = Math.max(trailMinutes, ACTIVITY_MINUTES)
  const router = useRouter()
  const [assets, setAssets] = useState(initialAssets)
  const assetsRef = useRef(initialAssets)
  const [trails, setTrails] = useState<Trails>({})
  const [status, setStatus] = useState<LiveStatus>('connecting')
  // Bumped when we may have missed updates, to refetch trail history.
  const [historyVersion, setHistoryVersion] = useState(0)
  const historyMinutesRef = useRef(historyMinutes)
  const now = useNow(15_000)

  useEffect(() => {
    historyMinutesRef.current = historyMinutes
  }, [historyMinutes])

  useEffect(() => {
    assetsRef.current = initialAssets
    setAssets(initialAssets)
  }, [initialAssets])

  const assetIdsKey = initialAssets.map((asset) => asset.id).join(',')
  useEffect(() => {
    if (trailMinutesSetting === null) return
    if (assetIdsKey === '') {
      setTrails({})
      return
    }
    let cancelled = false
    getTrails({ data: { minutes: historyMinutes, assetIds: assetIdsKey.split(',').map(Number) } })
      .then((history) => {
        if (!cancelled) setTrails(history)
      })
      .catch((error) => console.warn('Could not load trails:', error))
    return () => {
      cancelled = true
    }
  }, [trailMinutesSetting, historyMinutes, assetIdsKey, historyVersion])

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

  const visibleTrails = useMemo(
    () => (trailMinutes === 0 ? {} : pruneTrails(trails, now - trailMinutes * 60 * 1000)),
    [trails, trailMinutes, now],
  )

  const activities = useMemo(() => {
    const result: Record<number, Activity> = {}
    for (const [id, points] of Object.entries(trails)) {
      const activity = currentActivity(points, now)
      if (activity) result[Number(id)] = activity
    }
    return result
  }, [trails, now])

  return { assets, trails: visibleTrails, activities, status }
}
