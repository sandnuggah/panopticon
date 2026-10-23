import { placeStays } from '../lib/presence'
import type { LatLon } from '../lib/segments'
import { dayStats, type Day, type DayStats } from '../lib/stats'
import { trailProfile } from '../lib/tracker'
import { loadPlaces } from './places.server'
import { toTrailPoint } from './positions.server'
import { adapterFor } from './trackers.server'
import { getDevice, getPositionHistory } from './traccar.server'

// The Stats card's numbers, a day at a time: each day's positions from Traccar, worked out with the
// map's own rules (lib/stats.ts). A week of a tracker reporting every half minute is some 10,000
// positions, so only the results go to the browser, and days that are over are kept in memory:
// after the first look, only today is fetched again.

/** Days kept, across assets and users; a day's numbers are a few bytes. */
const MAX_CACHED = 20_000
/** How many days are fetched from Traccar at once. */
const PARALLEL = 4
/** A day this long over can't change any more (late reports from a tracker that was offline aside). */
const SETTLED_MS = 60 * 60 * 1000
/** Each day is worked out with this much either side, so what's around midnight is seen whole (see dayStats). */
const MARGIN_MS = 3 * 60 * 60 * 1000

const cache = new Map<string, DayStats>()

/** The asset's walks for each day, in order. `home`: where "furthest from Home" is measured from. */
export async function loadDayStats(token: string, assetId: number, days: Day[], home: LatLon | null): Promise<DayStats[]> {
  // Traccar checks access on each history request, but kept days skip those: check it first.
  if (!(await getDevice(token, assetId))) throw new Error('No such asset')
  // Its places, where its outings begin and end (see outings.ts), as on the map: kept days are kept by them too.
  const places = (await loadPlaces(token)).filter((place) => place.assetIds.includes(assetId))
  const where = `${home ? `${home.lat.toFixed(5)},${home.lon.toFixed(5)}` : '-'}:${JSON.stringify(places.map((place) => [place.id, place.area, place.wayIn ?? null]))}`
  const results: DayStats[] = new Array(days.length)
  let next = 0
  const work = async () => {
    while (next < days.length) {
      const index = next++
      const day = days[index]!
      const key = `${assetId}:${day.from}:${day.to}:${where}`
      const kept = cache.get(key)
      if (kept) {
        results[index] = kept
        continue
      }
      const end = Math.min(day.to + MARGIN_MS, Date.now())
      const positions = await getPositionHistory(token, assetId, new Date(day.from - MARGIN_MS), new Date(end))
      // Read as its kind of tracker reports (see trackers.server.ts).
      const profile = trailProfile(adapterFor(positions.find((position) => position.protocol)?.protocol).kind)
      const points = positions.map(toTrailPoint).sort((a, b) => a.time - b.time)
      // As of the end of what was fetched: a tracker silent after its last fix there was silent (a
      // departure that settled is none, see presence.ts), not cut off.
      const stats = dayStats(points, home, profile, placeStays(points, places, assetId, profile, end), day)
      results[index] = stats
      if (day.to + MARGIN_MS + SETTLED_MS <= Date.now()) {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
        cache.set(key, stats)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, days.length) }, work))
  return results
}
