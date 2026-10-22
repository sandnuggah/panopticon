import { createServerFn } from '@tanstack/react-start'
import { MAX_HISTORY_MINUTES } from '../lib/trail'
import { loadTrails } from './assets.server'
import { withToken } from './session.server'

export const getTrails = createServerFn({ method: 'GET' })
  .validator(parseTrailsInput)
  .handler(({ data }) => withToken((token) => loadTrails(token, data.assetIds, data.minutes)))

function parseTrailsInput(input: unknown): { assetIds: number[]; minutes: number } {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid trail request')
  const { assetIds, minutes } = input as Record<string, unknown>
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_HISTORY_MINUTES) {
    throw new Error('Invalid trail request')
  }
  if (!Array.isArray(assetIds) || assetIds.length > 50 || !assetIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error('Invalid trail request')
  }
  // Traccar checks that the user may see each device.
  return { assetIds: assetIds as number[], minutes }
}
