import { createServerFn } from '@tanstack/react-start'
import type { TrackerDetails } from '../lib/tracker'
import { loadAssets } from './assets.server'
import { withToken } from './session.server'
import { getDevice, getLatestPositions, getPositionHistory } from './traccar.server'
import { toTrackerDetails } from './tracker.server'

export const getAssets = createServerFn({ method: 'GET' }).handler(() => withToken(loadAssets))

/** How far back the report interval and the last GPS fix are looked for. */
const TRACKER_HISTORY_MS = 60 * 60 * 1000

/** The tracker details panel: fetched when it opens, and while it's open. */
export const getTrackerDetails = createServerFn({ method: 'GET' })
  .validator((input: unknown): number => {
    if (!Number.isInteger(input) || (input as number) <= 0) throw new Error('Invalid request')
    return input as number
  })
  .handler(({ data: assetId }) =>
    withToken(async (token): Promise<TrackerDetails> => {
      const to = new Date()
      const [device, latest, history] = await Promise.all([
        // Also Traccar's permission check: only devices this user may see are returned.
        getDevice(token, assetId),
        getLatestPositions(token),
        getPositionHistory(token, assetId, new Date(to.getTime() - TRACKER_HISTORY_MS), to),
      ])
      if (!device) throw new Error('No such asset')
      return toTrackerDetails(
        device,
        latest.find((position) => position.deviceId === assetId),
        history,
      )
    }),
  )
