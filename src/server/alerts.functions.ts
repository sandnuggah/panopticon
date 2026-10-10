import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestHeader } from '@tanstack/react-start/server'
import { isAlertRule, type AlertRule } from '../lib/alerts'
import { loadAlertSetup, savePhoneAlerts, sendTestAlert, type PhoneAlerts } from './alerts.server'
import { withToken } from './session.server'
import { isPushEndpoint, type PushTarget } from './webPush.server'

/** Settings → Alerts: whether alerts work here, and this phone's (by its push endpoint, if it has one). */
export const getAlertSetup = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    if (input === null) return null
    if (typeof input !== 'string' || !isPushEndpoint(input)) throw new Error('Invalid request')
    return input
  })
  .handler(({ data: endpoint }) => withToken((token) => loadAlertSetup(token, endpoint)))

/** This phone's alerts for every asset; none turns them off. */
export const savePhoneAlertChoices = createServerFn({ method: 'POST' })
  .validator((input: unknown): Omit<PhoneAlerts, 'origin'> => {
    const { target, timeZone, locale, rules } = fields(input)
    if (typeof timeZone !== 'string' || timeZone.length > 64 || typeof locale !== 'string' || locale.length > 35)
      throw new Error('Invalid request')
    const byAsset: Record<number, AlertRule[]> = {}
    for (const [id, list] of Object.entries(fields(rules))) {
      if (!/^[1-9]\d{0,15}$/.test(id) || !Array.isArray(list) || list.length > 50 || !list.every(isAlertRule))
        throw new Error('Invalid request')
      byAsset[Number(id)] = [...new Set(list)]
    }
    return { target: parseTarget(target), timeZone, locale, rules: byAsset }
  })
  .handler(({ data }) => withToken((token) => savePhoneAlerts(token, { ...data, origin: requestOrigin() })))

/** A test alert to this phone. */
export const sendPhoneTestAlert = createServerFn({ method: 'POST' })
  .validator((input: unknown) => parseTarget(fields(input).target))
  .handler(({ data }) => withToken(() => sendTestAlert(data, requestOrigin())))

/** Panopticon's address as the phone sees it (behind a proxy too): the request's Origin header. */
function requestOrigin(): string {
  const origin = getRequestHeader('origin') ?? new URL(getRequest().url).origin
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new Error('Invalid request')
  return origin
}

function parseTarget(input: unknown): PushTarget {
  const { endpoint, p256dh, auth } = fields(input)
  if (typeof endpoint !== 'string' || !isPushEndpoint(endpoint)) throw new Error('Invalid request')
  if (typeof p256dh !== 'string' || Buffer.from(p256dh, 'base64url').length !== 65) throw new Error('Invalid request')
  if (typeof auth !== 'string' || Buffer.from(auth, 'base64url').length !== 16) throw new Error('Invalid request')
  return { endpoint, p256dh, auth }
}

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid request')
  return input as Record<string, unknown>
}
