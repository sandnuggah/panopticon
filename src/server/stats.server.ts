import type { LatLon } from '../lib/segments'
import { dayStats, type Day, type DayStats } from '../lib/stats'
import { toTrailPoint } from './assets.server'
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

const cache = new Map<string, DayStats>()

/** The asset's walks for each day, in order. `home`: where "furthest from Home" is measured from. */
export async function loadDayStats(token: string, assetId: number, days: Day[], home: LatLon | null): Promise<DayStats[]> {
  // Traccar checks access on each history request, but kept days skip those: check it first.
  if (!(await getDevice(token, assetId))) throw new Error('No such asset')
  const where = home ? `${home.lat.toFixed(5)},${home.lon.toFixed(5)}` : '-'
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
      const positions = await getPositionHistory(token, assetId, new Date(day.from), new Date(day.to))
      const stats = dayStats(
        positions.map(toTrailPoint).sort((a, b) => a.time - b.time),
        home,
      )
      results[index] = stats
      if (day.to + SETTLED_MS <= Date.now()) {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
        cache.set(key, stats)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, days.length) }, work))
  return results
}
