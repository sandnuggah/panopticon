import { useEffect, useMemo, useRef, useState } from 'react'
import { matchWalks } from '../server/map.functions'
import { matchableWalks, otherWalks, type MatchableWalk } from './matching'
import { isInPark, type Park } from './parks'
import type { LatLon } from './segments'
import { nextTry, snappedLines, toAsk, withAnswers, type AssetWalk, type SnappedLines, type SnapState } from './snapLines'
import { trailProfile, type TrackerKind } from './tracker'
import type { TrailViews } from './trailGeometry'

/** A request that hasn't come back after this long has failed: asked again later, so one lost request can't stop it. */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Snap to paths: the lines to draw the walks on these trails along (as the map draws them, see
 * useLiveAssets), by asset and walk (see snapLines.ts). A walk is asked for as soon as it changes,
 * one request at a time; while a longer version of it is asked for, the line it had is kept. A walk
 * the server can't snap closely enough has no line, and is drawn as recorded; one it couldn't ask
 * Valhalla about is asked again, later and later. `parks` (from the map, null until it's ready):
 * fixes in them are snapped more strictly, so walks wait for them. `trackers`: read as each asset's
 * kind of tracker reports.
 */
export function useSnappedWalks(
  trails: TrailViews,
  enabled: boolean,
  parks: Park[] | null,
  trackers: Record<number, TrackerKind | undefined>,
): SnappedLines {
  const [state, setState] = useState<SnapState>(new Map())
  // A request is out: the next waits for it, so answers come in order.
  const asking = useRef(false)
  // Bumped when a request comes back or it's time to try again, to look for what to ask next.
  const [wake, setWake] = useState(0)
  // Where fixes were seen to be in a park, kept for the session: the map's tiles only have what's in
  // view, and a walk shouldn't change back when the map moves away from it.
  const inParks = useRef(new Set<string>())

  const [walks, others] = useMemo((): [AssetWalk[], AssetWalk[]] => {
    if (!enabled || !parks) return [[], []]
    const inPark = (point: LatLon) => {
      const where = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`
      if (inParks.current.has(where)) return true
      if (!isInPark(point, parks)) return false
      inParks.current.add(where)
      return true
    }
    const all = Object.entries(trails).map(([id, view]) => {
      const worth = matchableWalks(view.pieces, inPark, trailProfile(trackers[Number(id)]))
      const asset = (walk: MatchableWalk) => ({ ...walk, asset: Number(id) })
      return [worth.map(asset), otherWalks(view.pieces, worth).map(asset)] as const
    })
    return [all.flatMap(([worth]) => worth), all.flatMap(([, rest]) => rest)]
  }, [trails, enabled, parks, trackers])
  // The walks as they are when an answer comes, to forget those no longer on the map.
  const walksRef = useRef([...walks, ...others])
  walksRef.current = [...walks, ...others]

  useEffect(() => {
    if (asking.current) return
    const ask = toAsk(walks, state, Date.now())
    if (ask.length === 0) {
      // Nothing to ask now: maybe later, after a failure.
      const next = nextTry(walks, state)
      if (next === null) return
      const timer = setTimeout(() => setWake((n) => n + 1), Math.max(0, next - Date.now()))
      return () => clearTimeout(timer)
    }
    asking.current = true
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer')), REQUEST_TIMEOUT_MS))
    Promise.race([matchWalks({ data: ask.map((walk) => walk.points) }), timeout])
      .then((answers) => setState((current) => withAnswers(current, ask, answers, Date.now(), walksRef.current)))
      .catch((error) => {
        // Unreachable or signed out: asked again later.
        console.warn('Could not snap walks to roads:', error)
        setState((current) =>
          withAnswers(
            current,
            ask,
            ask.map(() => 'unavailable' as const),
            Date.now(),
            walksRef.current,
          ),
        )
      })
      .finally(() => {
        asking.current = false
        setWake((n) => n + 1)
      })
  }, [walks, state, wake])

  return useMemo(() => snappedLines(walks, state, others), [walks, others, state])
}
