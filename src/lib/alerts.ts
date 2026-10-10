// Alerts: push notifications to a phone when an asset leaves or arrives at a place, or its
// tracker goes offline, sent by panopticon's server when Traccar forwards the event (see
// alerts.server.ts). Each phone chooses its own, per asset. No runtime imports, so Node can run
// the tests directly.

/** What a phone wants to hear about for one asset: leaving or arriving at a place (by id), or the tracker going offline. */
export type AlertRule = `leave:${number}` | `arrive:${number}` | 'offline'

export function isAlertRule(value: unknown): value is AlertRule {
  return typeof value === 'string' && /^(?:(?:leave|arrive):[1-9]\d{0,15}|offline)$/.test(value)
}

/** Traccar event types an alert can be about. */
export type AlertEvent = { type: string; geofenceId: number }

/** The rule an event of Traccar's matches, if any: geofenceExit, geofenceEnter, and the tracker going offline or quiet. */
export function ruleForEvent(event: AlertEvent): AlertRule | null {
  if (event.type === 'geofenceExit' && event.geofenceId > 0) return `leave:${event.geofenceId}`
  if (event.type === 'geofenceEnter' && event.geofenceId > 0) return `arrive:${event.geofenceId}`
  if (event.type === 'deviceOffline' || event.type === 'deviceUnknown') return 'offline'
  return null
}

/** "Betty left Home", "Betty arrived at Daycare", "Betty's tracker went offline". */
export function alertTitle(rule: AlertRule, assetName: string, placeName: string | null): string {
  if (rule === 'offline') return `${assetName}'s tracker went offline`
  const place = placeName ?? 'a place'
  return rule.startsWith('leave:') ? `${assetName} left ${place}` : `${assetName} arrived at ${place}`
}

/** "At 14:02", in the phone's own time zone and language; falls back to UTC and English if they're unknown. */
export function alertBody(time: string, timeZone: string, locale: string): string {
  const date = new Date(time)
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  }
  return `At ${format.format(date)}`
}

/** The rules one asset offers: leaving and arriving at each of its places, and going offline. */
export function rulesFor(placeIds: number[]): AlertRule[] {
  return [...placeIds.flatMap((id): AlertRule[] => [`leave:${id}`, `arrive:${id}`]), 'offline']
}
