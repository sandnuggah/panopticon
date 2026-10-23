import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getUser } from '../server/auth.functions'
import { getHistory, getTrails } from '../server/trails.functions'
import type { Asset } from './asset'
import { BUILD_ID } from './buildId'
import { applyUpdates, type LiveUpdate } from './live'
import type { Place, PlaceVisit } from './places'
import { assetVisits, currentStays, keepFrom, news, presences, shownAssets, startsInVisit, whileLoading, type Visit } from './presence'
import { currentActivity, type Activity } from './segments'
import { trackersOf, trailProfile } from './tracker'
import {
  extendTrails,
  historyMinutes,
  MAX_EXTRA_HISTORY_MS,
  MAX_HISTORY_MINUTES,
  keepEarlier,
  mergeHistory,
  MISSED_AFTER_MS,
  MISSED_SILENCE_MS,
  trailOptionsOf,
  trailStart,
  type Trails,
} from './trail'
import { quietAssets, shownKey, shownTrails, trailViews, type TrailViewCache } from './trailGeometry'
import { useNow } from './useNow'

export type LiveStatus = 'connecting' | 'live' | 'offline'

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000
/** An arrival or departure a history load finds this recent is news ("Kofi left Home"); older, it's what a page opened again found out. */
const NEWS_MS = 10 * 60 * 1000
/**
 * A history load that failed is tried again after this long, up to this many tries in all: until it
 * comes, the page may have missed reports. Then it goes on with what it has.
 */
const LOAD_RETRY_MS = 10_000
const LOAD_TRIES = 3

/**
 * Keeps the asset list and trails current from /live. `initialAssets` is the route loader's data;
 * whenever it's reloaded (reconnect, returning to the tab) it replaces the live state.
 * History covers a day and HISTORY_MIN_MINUTES before it (see historyMinutes), even with trails off,
 * to tell what each asset is doing right now and where it is; the trails are worked out from all of it
 * and returned for drawing from where each asset's trail starts, as chosen for it (see trailFrom and
 * trailOptionsOf).
 * `onVisits` hears of arrivals and departures as they happen (see presence.ts).
 */
export function useLiveAssets(initialAssets: Asset[], places: Place[], onVisits?: (visits: PlaceVisit[]) => void) {
  const historyLength = historyMinutes()
  const router = useRouter()
  const [assets, setAssets] = useState(initialAssets)
  const assetsRef = useRef(initialAssets)
  const [trails, setTrails] = useState<Trails>({})
  // Whether the first trail history has come back (or failed), for the loading screen; which history
  // last came (see loadKey), and whether where the assets are next comes from it.
  const [trailsLoaded, setTrailsLoaded] = useState(false)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loaded = useRef(true)
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [visible, setVisible] = useState(true)
  // A newer release is serving than the one this page came from (see buildId.ts).
  const [updateAvailable, setUpdateAvailable] = useState(false)
  // Bumped when we may have missed updates, to refetch trail history.
  const [historyVersion, setHistoryVersion] = useState(0)
  const historyLengthRef = useRef(historyLength)
  // From when each asset's points stay in its history (see keepFrom), for the live updates.
  const keep = useRef<Record<number, number>>({})
  // For each asset, the first point its history was fetched further back from (see startsInVisit).
  const earlier = useRef(new Map<number, number>())
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

  // The history asked for: until it has come, the page may have missed reports (see inStep). Asked
  // for again when one fails.
  const assetIdsKey = initialAssets.map((asset) => asset.id).join(',')
  const loadKey = `${historyVersion} ${assetIdsKey}`
  const failures = useRef(0)
  useEffect(() => {
    if (assetIdsKey === '') {
      setTrails({})
      setTrailsLoaded(true)
      setLoadedKey(loadKey)
      return
    }
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    getTrails({ data: { minutes: historyLength, assetIds: assetIdsKey.split(',').map(Number) } })
      .then((history) => {
        // A failed server function can resolve with nothing (seen on a fresh dev server); keep
        // the trails we have rather than crash the map.
        if (!history) throw new Error('no history')
        if (cancelled) return
        ;[loaded.current, failures.current] = [true, 0]
        earlier.current.clear()
        setTrails((current) => keepEarlier(history, current, keep.current))
        setLoadedKey(loadKey)
      })
      .catch((error) => {
        console.warn('Could not load trails:', error)
        if (cancelled) return
        if (++failures.current < LOAD_TRIES) retry = setTimeout(() => setHistoryVersion((version) => version + 1), LOAD_RETRY_MS)
        else [loaded.current, failures.current] = [true, 0]
        if (failures.current === 0) setLoadedKey(loadKey)
      })
      .finally(() => {
        if (!cancelled) setTrailsLoaded(true)
      })
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [historyLength, loadKey])

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
      setTrails((current) => {
        for (const update of updates) {
          if (update.kind !== 'position') continue
          const last = current[update.id]?.at(-1)
          if (last && Date.parse(update.location.fixTime) - last.time > MISSED_SILENCE_MS) fetchMissed(update.id, last.time)
        }
        return extendTrails(current, updates, historyLengthRef.current, Date.now(), keep.current)
      })
    }

    // The reports since a silence began, once the tracker has uploaded what it kept (see MISSED_SILENCE_MS).
    const missed = new Map<number, ReturnType<typeof setTimeout>>()
    const fetchMissed = (assetId: number, from: number) => {
      if (missed.has(assetId)) return
      const timer = setTimeout(() => {
        getHistory({ data: { assetId, from, to: Date.now() } })
          .then((points) => {
            if (!points?.length) return
            loaded.current = true
            setTrails((current) => (current[assetId] ? { ...current, [assetId]: mergeHistory(current[assetId], points) } : current))
          })
          .catch((error) => console.warn('Could not load missed reports:', error))
          .finally(() => missed.delete(assetId))
      }, MISSED_AFTER_MS)
      missed.set(assetId, timer)
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
      setVisible(document.visibilityState === 'visible')
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
      for (const timer of missed.values()) clearTimeout(timer)
      source?.close()
    }
  }, [router])

  // Read as each asset's kind of tracker reports.
  const trackerKey = assets.map((asset) => `${asset.id}:${asset.tracker ?? ''}`).join(' ')
  const trackers = useMemo(() => trackersOf(assets), [trackerKey])

  // Where the assets are goes by the clock (see presence.ts) while the page is in step with them: in
  // view, live, and with the history it asked for. Else the page may have missed reports: the clock
  // stays at its last tick in step, so a tracker doesn't go quiet for reports that didn't come.
  const inStep = visible && status === 'live' && trailsLoaded && loadedKey === loadKey
  const [steady, setSteady] = useState(now)
  useEffect(() => {
    if (inStep) setSteady(now)
  }, [inStep, now])
  const clock = inStep ? now : steady

  // Each asset's trail, worked out from all of its points as they come, not as the clock ticks (see
  // trailViews; but once when its tracker goes quiet), and drawn from where the trail starts: the
  // same until a whole piece drops off its old end (see firstShown), so kept until then.
  const worked = useRef<TrailViewCache>(new Map())
  const quieted = quietAssets(trails, trackers, clock)
  const quietKey = quieted.join(' ')
  const quiet = useMemo(() => new Map(quieted), [quietKey])
  const views = useMemo(() => trailViews(trails, places, trackers, worked.current, quiet), [trails, places, trackers, quiet])
  // Each asset's own length (see trailOptionsOf), new only when one changes, not with each position.
  const lengthsKey = assets.map((asset) => `${asset.id}:${trailOptionsOf(asset).length}`).join(' ')
  const lengths = useMemo(() => new Map(assets.map((asset) => [asset.id, trailOptionsOf(asset).length])), [lengthsKey])
  const lengthOf = useCallback((id: number) => lengths.get(id) ?? trailOptionsOf(undefined).length, [lengths])
  const start = useCallback((id: number) => trailStart(lengthOf(id), now), [lengthOf, now])
  const shown = useMemo(() => shownTrails(views, start), [views, shownKey(views, start)])

  const activities = useMemo(() => {
    const result: Record<number, Activity> = {}
    for (const [id, points] of Object.entries(trails)) {
      const activity = currentActivity(points, now, trailProfile(trackers[Number(id)]))
      if (activity) result[Number(id)] = activity
    }
    return result
  }, [trails, now, trackers])

  // Where each asset is as its places go (see presence.ts): worked out again as reports come, and as
  // the clock ticks, since a tracker that goes quiet near a place has arrived there; out of step, as
  // far as is known (see whileLoading).
  const visits = useMemo(() => assetVisits(trails, places, trackers, clock), [trails, places, trackers, clock])
  const found = useMemo(() => presences(trails, places, trackers, clock, assets, visits), [trails, places, trackers, clock, assets, visits])
  const where = useMemo(() => (inStep ? found : whileLoading(found, assets, places, trails)), [found, inStep, assets, places, trails])

  // Each asset's points from the visit it's at stay as the history's start moves on (see keepFrom);
  // a history that starts inside it is fetched further back, a day at a time, to when it began.
  useEffect(() => {
    keep.current = Object.fromEntries(
      Object.entries(visits).flatMap(([key, list]) => {
        const from = keepFrom(trails[Number(key)] ?? [], list, places, Number(key), trailProfile(trackers[Number(key)]))
        return from === undefined ? [] : [[key, from]]
      }),
    )
  }, [visits, trails, places, trackers])
  useEffect(() => {
    if (!inStep) return
    for (const [key, list] of Object.entries(visits)) {
      const id = Number(key)
      const first = trails[id]?.[0]?.time
      // Asked for already, back from this first point: nothing earlier, or on its way.
      if (!startsInVisit(list) || first === undefined || earlier.current.get(id) === first) continue
      const from = Math.max(first - MAX_HISTORY_MINUTES * 60 * 1000, Date.now() - MAX_EXTRA_HISTORY_MS)
      if (from >= first) continue
      earlier.current.set(id, first)
      getHistory({ data: { assetId: id, from, to: first } })
        .then((points) => {
          // Nothing earlier: as far back as there is.
          if (!points?.length) return
          loaded.current = true
          // Kept by live updates that come before the keep is worked out again.
          keep.current = { ...keep.current, [id]: Math.min(keep.current[id] ?? Infinity, points[0]!.time) }
          setTrails((current) => (current[id] ? { ...current, [id]: mergeHistory(current[id], points) } : current))
        })
        .catch((error) => console.warn('Could not load earlier history:', error))
    }
  }, [visits, inStep, trails])

  // "Kofi left Home": the visits that end or begin (see news), as it happens, while in step; what a
  // history load or a change of places finds out, if it's recent.
  const said = useRef<Record<number, Visit[]>>({})
  const saidPlaces = useRef(places)
  useEffect(() => {
    if (!inStep) return
    const fromLoad = loaded.current || saidPlaces.current !== places
    ;[loaded.current, saidPlaces.current] = [false, places]
    const changes: PlaceVisit[] = []
    for (const [key, list] of Object.entries(visits)) {
      const before = said.current[Number(key)]
      if (!before) continue
      for (const change of news(before, list)) {
        if (fromLoad && Date.now() - change.time > NEWS_MS) continue
        changes.push({ assetId: Number(key), placeId: change.placeId, arrived: change.arrived, time: new Date(change.time).toISOString() })
      }
    }
    said.current = visits
    if (changes.length > 0) onVisitsRef.current?.(changes)
  }, [visits, inStep, places])

  // Staying put away from its places (at them, it's where it is that says), since it left one.
  const stays = useMemo(() => currentStays(trails, lengthOf, now, trackers, where), [trails, lengthOf, now, trackers, where])

  // Each asset where its trail can trust it to be, and at its place's centre while it's at one (see shownLocation).
  const shownAssetsNow = useMemo(() => shownAssets(assets, trails, where, places), [assets, trails, where, places])

  return { assets: shownAssetsNow, trails: shown, views, trailsLoaded, activities, stays, presence: where, status, updateAvailable }
}
