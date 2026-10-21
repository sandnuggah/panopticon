import { useEffect, useMemo, useRef, useState } from 'react'
import { matchWalks } from '../server/map.functions'
import { MAX_WALKS_PER_REQUEST, matchableWalks, type MatchablePoint } from './matching'
import { isInPark, type Park } from './parks'
import { trailPlaces, type Place } from './places'
import { trailProfile, type TrackerKind } from './tracker'
import { classifyTrail, type LatLon } from './segments'
import type { Trails } from './trail'

/** Waits this long after the trail changes before asking, so bursts of live updates make one request. */
const DEBOUNCE_MS = 1_000

/**
 * Snap to paths: the walks on these trails snapped to streets and paths, by walk key (see
 * matching.ts). Walks the server can't snap closely enough are simply missing, and drawn as recorded.
 * `parks` (from the map, null until it's ready): fixes in them are snapped more strictly, so walks
 * wait for them. `places`, `trackers`: the walks are those the map draws, with stays at an asset's
 * places as one, read as its kind of tracker reports.
 */
export function useSnappedWalks(
  trails: Trails,
  enabled: boolean,
  parks: Park[] | null,
  places: Place[],
  trackers: Record<number, TrackerKind | undefined>,
): Record<string, LatLon[]> {
  // null: asked, and it can't be snapped.
  const [results, setResults] = useState<Record<string, LatLon[] | null>>({})
  const asked = useRef(new Set<string>())
  // Where fixes were seen to be in a park, kept for the session: the map's tiles only have what's in
  // view, and a walk shouldn't change back when the map moves away from it.
  const inParks = useRef(new Set<string>())

  const walks = useMemo(() => {
    if (!enabled || !parks) return []
    const inPark = (point: LatLon) => {
      const where = `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`
      if (inParks.current.has(where)) return true
      if (!isInPark(point, parks)) return false
      inParks.current.add(where)
      return true
    }
    return Object.entries(trails).flatMap(([id, points]) => {
      const profile = trailProfile(trackers[Number(id)])
      const pieces = classifyTrail(points, { showWandering: true, places: trailPlaces(places, Number(id)), profile })
      return matchableWalks(pieces, inPark, profile)
    })
  }, [trails, enabled, parks, places, trackers])

  useEffect(() => {
    // Asked again when more of a walk's fixes turn out to be in a park: parks come from the tiles in
    // view, so they fill in as the map moves.
    const missing = walks.filter((walk) => !asked.current.has(askedKey(walk))).slice(0, MAX_WALKS_PER_REQUEST)
    if (missing.length === 0) return
    const timer = setTimeout(() => {
      for (const walk of missing) asked.current.add(askedKey(walk))
      matchWalks({ data: missing.map((walk) => walk.points) })
        .then((lines) => {
          const current = new Set(walks.map(askedKey))
          setResults((previous) => {
            // Keep only walks still on the trail; a growing walk replaces its earlier versions.
            const keys = new Set(walks.map((walk) => walk.key))
            const next: Record<string, LatLon[] | null> = {}
            for (const [key, line] of Object.entries(previous)) if (keys.has(key)) next[key] = line
            missing.forEach((walk, index) => (next[walk.key] = lines[index] ?? null))
            return next
          })
          for (const key of asked.current) if (!current.has(key)) asked.current.delete(key)
        })
        .catch((error) => {
          // Unreachable or signed out: forget these so they're asked again later.
          for (const walk of missing) asked.current.delete(askedKey(walk))
          console.warn('Could not snap walks to roads:', error)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `results` too: when a batch comes back, send the next if more than one batch's worth is waiting.
  }, [walks, results])

  return useMemo(() => {
    const snapped: Record<string, LatLon[]> = {}
    for (const walk of walks) {
      const line = results[walk.key]
      if (line) snapped[walk.key] = line
    }
    return snapped
  }, [walks, results])
}

/** A walk as asked for: which walk, and which of its fixes are in a park. */
function askedKey(walk: { key: string; points: MatchablePoint[] }): string {
  return `${walk.key}:${walk.points.map((point) => (point.park ? 'p' : '-')).join('')}`
}
