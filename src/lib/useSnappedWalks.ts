import { useEffect, useMemo, useRef, useState } from 'react'
import { matchWalks } from '../server/map.functions'
import { MAX_WALKS_PER_REQUEST, matchableWalks } from './matching'
import { isInPark, type Park } from './parks'
import { classifyTrail, type LatLon } from './segments'
import type { Trails } from './trail'

/** Waits this long after the trail changes before asking, so bursts of live updates make one request. */
const DEBOUNCE_MS = 1_000

/**
 * Snap to paths: the walks on these trails snapped to streets and paths, by walk key (see
 * matching.ts). Walks the server can't snap closely enough are simply missing, and drawn as recorded.
 * `parks` (from the map, null until it's ready): fixes in them are snapped more strictly, so walks
 * wait for them.
 */
export function useSnappedWalks(trails: Trails, enabled: boolean, parks: Park[] | null): Record<string, LatLon[]> {
  // null: asked, and it can't be snapped.
  const [results, setResults] = useState<Record<string, LatLon[] | null>>({})
  const asked = useRef(new Set<string>())

  const walks = useMemo(
    () =>
      enabled && parks
        ? Object.values(trails).flatMap((points) =>
            matchableWalks(classifyTrail(points, { showWandering: true }), (point) => isInPark(point, parks)),
          )
        : [],
    [trails, enabled, parks],
  )

  useEffect(() => {
    const missing = walks.filter((walk) => !asked.current.has(walk.key)).slice(0, MAX_WALKS_PER_REQUEST)
    if (missing.length === 0) return
    const timer = setTimeout(() => {
      for (const walk of missing) asked.current.add(walk.key)
      matchWalks({ data: missing.map((walk) => walk.points) })
        .then((lines) => {
          const current = new Set(walks.map((walk) => walk.key))
          setResults((previous) => {
            // Keep only walks still on the trail; a growing walk replaces its earlier versions.
            const next: Record<string, LatLon[] | null> = {}
            for (const [key, line] of Object.entries(previous)) if (current.has(key)) next[key] = line
            missing.forEach((walk, index) => (next[walk.key] = lines[index] ?? null))
            return next
          })
          for (const key of asked.current) if (!current.has(key)) asked.current.delete(key)
        })
        .catch((error) => {
          // Unreachable or signed out: forget these so they're asked again later.
          for (const walk of missing) asked.current.delete(walk.key)
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
