import { createServerFn } from '@tanstack/react-start'
import { MAX_POINTS_PER_WALK, MAX_WALKS_PER_REQUEST, type MatchablePoint } from '../lib/matching'
import { env } from './env.server'
import { matchWalk } from './matching.server'
import { withToken } from './session.server'

/**
 * The maplibre style URL (not secret; it lives in env so it can point at a self-hosted tile server),
 * and whether "Follow roads" is available (MAP_MATCHING_URL is set).
 */
export const getMapOptions = createServerFn({ method: 'GET' }).handler(() => ({
  styleUrl: env().mapStyleUrl,
  followRoads: env().mapMatchingUrl !== undefined,
}))

/** Snaps walks to streets and paths; null for each walk that can't be snapped closely enough. */
export const matchWalks = createServerFn({ method: 'POST' })
  .validator(parseWalks)
  .handler(({ data }) => withToken(() => Promise.all(data.map((walk) => matchWalk(walk)))))

function parseWalks(input: unknown): MatchablePoint[][] {
  if (!Array.isArray(input) || input.length > MAX_WALKS_PER_REQUEST) throw new Error('Invalid request')
  return input.map((walk: unknown) => {
    if (!Array.isArray(walk) || walk.length < 2 || walk.length > MAX_POINTS_PER_WALK) throw new Error('Invalid request')
    return walk.map((point: unknown) => {
      const { lat, lon, time } = (point ?? {}) as Record<string, unknown>
      const ok =
        typeof lat === 'number' && Math.abs(lat) <= 90 &&
        typeof lon === 'number' && Math.abs(lon) <= 180 &&
        typeof time === 'number' && Number.isFinite(time)
      if (!ok) throw new Error('Invalid request')
      return { lat, lon, time }
    })
  })
}
