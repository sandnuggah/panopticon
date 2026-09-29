import { createServerFn } from '@tanstack/react-start'
import { LIVE_LINK_HOURS } from '../lib/share'
import { sessionExpiresAt, withToken } from './session.server'
import { createLiveLink, loadSharedView, sharedAddress, stopLiveLink } from './sharing.server'

/** Signed in: a new live location link for one asset. */
export const createLink = createServerFn({ method: 'POST' })
  .validator(parseCreate)
  .handler(({ data }) =>
    withToken(async (token) => {
      const expiresAt = await sessionExpiresAt()
      if (!expiresAt) throw new Error('Not signed in')
      return createLiveLink(token, expiresAt, data.assetId, data.hours)
    }),
  )

/** Signed in: stops a live location link the user has. */
export const stopLink = createServerFn({ method: 'POST' })
  .validator(parseLink)
  .handler(({ data }) => withToken(() => stopLiveLink(data)))

/** Public: what a live location link shows. The link itself is the permission. */
export const getSharedView = createServerFn({ method: 'GET' })
  .validator(parseLink)
  .handler(({ data }) => loadSharedView(data))

/** Public: the shared asset's current address. */
export const getSharedAddress = createServerFn({ method: 'POST' })
  .validator(parseLink)
  .handler(({ data }) => sharedAddress(data))

function parseCreate(input: unknown): { assetId: number; hours: number } {
  const { assetId, hours } = (input ?? {}) as Record<string, unknown>
  if (!Number.isInteger(assetId) || (assetId as number) <= 0) throw new Error('Invalid request')
  if (!(LIVE_LINK_HOURS as readonly unknown[]).includes(hours)) throw new Error('Invalid request')
  return { assetId: assetId as number, hours: hours as number }
}

function parseLink(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/.test(input)) throw new Error('Invalid request')
  return input
}
