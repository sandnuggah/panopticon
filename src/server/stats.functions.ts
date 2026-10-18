import { createServerFn } from '@tanstack/react-start'
import type { LatLon } from '../lib/segments'
import type { Day } from '../lib/stats'
import { withToken } from './session.server'
import { loadDayStats } from './stats.server'

/** At most this many days per request: a month and the month before, or the streak's 90 days. */
const MAX_DAYS = 92
/** A local day is 23–25 hours, with daylight saving. */
const MAX_DAY_MS = 25 * 60 * 60 * 1000

/** An asset's walks day by day (see stats.server.ts). POST so where Home is stays out of URLs and proxy logs. */
export const getDayStats = createServerFn({ method: 'POST' })
  .validator(parseInput)
  .handler(({ data }) => withToken((token) => loadDayStats(token, data.assetId, data.days, data.home)))

function parseInput(input: unknown): { assetId: number; days: Day[]; home: LatLon | null } {
  const { assetId, days, home } = (input ?? {}) as Record<string, unknown>
  if (typeof assetId !== 'number' || !Number.isInteger(assetId) || assetId <= 0) throw new Error('Invalid request')
  if (!Array.isArray(days) || days.length === 0 || days.length > MAX_DAYS) throw new Error('Invalid request')
  const parsed = days.map((day: unknown) => {
    const { from, to } = (day ?? {}) as Record<string, unknown>
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Invalid request')
    const [start, end] = [from as number, to as number]
    if (end <= start || end - start > MAX_DAY_MS) throw new Error('Invalid request')
    return { from: start, to: end }
  })
  return { assetId, days: parsed, home: parseHome(home) }
}

function parseHome(home: unknown): LatLon | null {
  if (home === null || home === undefined) return null
  const { lat, lon } = home as Record<string, unknown>
  if (typeof lat !== 'number' || !(Math.abs(lat) <= 90) || typeof lon !== 'number' || !(Math.abs(lon) <= 180))
    throw new Error('Invalid request')
  return { lat, lon }
}
