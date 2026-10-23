import { createServerFn } from '@tanstack/react-start'
import { MAX_EXTRA_HISTORY_MS, MAX_HISTORY_MINUTES } from '../lib/trail'
import { loadHistory, loadTrails } from './assets.server'
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

/** One asset's reports from `from` to `to` (ms): more of its history (see useLiveAssets). */
export const getHistory = createServerFn({ method: 'GET' })
  .validator(parseHistoryInput)
  .handler(({ data }) => withToken((token) => loadHistory(token, data.assetId, data.from, data.to)))

function parseHistoryInput(input: unknown): { assetId: number; from: number; to: number } {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid history request')
  const { assetId, from, to } = input as Record<string, unknown>
  if (typeof assetId !== 'number' || !Number.isInteger(assetId) || assetId <= 0) throw new Error('Invalid history request')
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to))
    throw new Error('Invalid history request')
  // No more than a day and 3 hours at a time (the latest of it), nor further back than the trail ever reaches.
  const start = Math.max(from, to - MAX_HISTORY_MINUTES * 60 * 1000, Date.now() - MAX_EXTRA_HISTORY_MS)
  if (to <= start) throw new Error('Invalid history request')
  return { assetId, from: start, to }
}
