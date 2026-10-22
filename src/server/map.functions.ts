import { createServerFn } from '@tanstack/react-start'
import { mapStylesFor } from '../lib/mapStyles'
import { MAX_POINTS_PER_WALK, MAX_WALKS_PER_REQUEST, type MatchablePoint } from '../lib/matching'
import { lookUpAddress } from './address.server'
import { env } from './env.server'
import { matchWalk } from './matching.server'
import { withToken } from './session.server'

/**
 * The map styles to choose between, from MAP_STYLE_URL (not secret; it lives in env so it can point
 * at a self-hosted tile server), and whether Snap to paths is available (MAP_MATCHING_URL is set).
 */
export const getMapOptions = createServerFn({ method: 'GET' }).handler(() => ({
  ...mapStylesFor(env().mapStyleUrl),
  canSnapToPaths: env().mapMatchingUrl !== undefined,
  canSearchAddresses: env().geocoderUrl !== undefined,
}))

/**
 * Snaps walks to streets and paths: for each, its line, null when it can't be snapped closely enough,
 * or 'unavailable' when Valhalla can't be asked right now (see matchWalk).
 */
export const matchWalks = createServerFn({ method: 'POST' })
  .validator(parseWalks)
  .handler(({ data }) => withToken(() => Promise.all(data.map((walk) => matchWalk(walk)))))

/** The street address near a point, or null. POST so coordinates stay out of URLs and proxy logs. */
export const getAddress = createServerFn({ method: 'POST' })
  .validator(parsePoint)
  .handler(({ data }) => withToken((token) => lookUpAddress(token, data.lat, data.lon)))

function parsePoint(input: unknown): { lat: number; lon: number } {
  const { lat, lon } = (input ?? {}) as Record<string, unknown>
  if (typeof lat !== 'number' || !(Math.abs(lat) <= 90) || typeof lon !== 'number' || !(Math.abs(lon) <= 180)) {
    throw new Error('Invalid request')
  }
  return { lat, lon }
}

function parseWalks(input: unknown): MatchablePoint[][] {
  if (!Array.isArray(input) || input.length > MAX_WALKS_PER_REQUEST) throw new Error('Invalid request')
  return input.map((walk: unknown) => {
    if (!Array.isArray(walk) || walk.length < 2 || walk.length > MAX_POINTS_PER_WALK) throw new Error('Invalid request')
    return walk.map((point: unknown) => {
      const { lat, lon, time, park, anchor, unseen } = (point ?? {}) as Record<string, unknown>
      const ok =
        typeof lat === 'number' &&
        Math.abs(lat) <= 90 &&
        typeof lon === 'number' &&
        Math.abs(lon) <= 180 &&
        typeof time === 'number' &&
        Number.isFinite(time)
      if (!ok) throw new Error('Invalid request')
      return {
        lat,
        lon,
        time,
        ...(park === true && { park: true }),
        ...(anchor === true && { anchor: true }),
        ...(unseen === true && { unseen: true }),
      }
    })
  })
}
