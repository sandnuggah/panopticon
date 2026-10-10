import type { Asset, AssetLocation } from './asset'

// Sharing where an asset is through the phone's share sheet: once, as a sentence and a map link that
// opens for anyone, or as a live location link to a page that follows it until the link expires
// (see liveLinks.server.ts).

/** A fix older than this is shared as where the asset was, with the time. */
const FRESH_MS = 5 * 60 * 1000

export type LocationShare = { title: string; text: string; url: string }

type Formats = { time: Intl.DateTimeFormat; weekdayTime: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat }

const defaultFormats: Formats = {
  time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
  weekdayTime: new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
  dateTime: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
}

/** How long a live location link can last. */
export const LIVE_LINK_HOURS = [1, 8, 24] as const

/**
 * What a live location link shows. `stopped` is a link Traccar no longer accepts before its expiry:
 * stopped by the sharer, or the sharer lost access. The asset never has a battery reading here.
 */
export type SharedView =
  | { kind: 'live'; asset: Asset; address: string | null; expiresAt: number }
  | { kind: 'expired' }
  | { kind: 'stopped' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }

/** "20:30" today, "Wed 05:04" within six days either way, otherwise with the date. */
export function formatTime(time: number, now: number, formats: Formats = defaultFormats): string {
  if (new Date(time).toDateString() === new Date(now).toDateString()) return formats.time.format(time)
  if (Math.abs(time - now) < 6 * 24 * 60 * 60 * 1000) return formats.weekdayTime.format(time)
  return formats.dateTime.format(time)
}

/** What to send with a live location link: "Follow Betty live until 20:30." */
export function liveLinkShare(name: string, url: string, expiresAt: number, now: number, formats = defaultFormats): LocationShare {
  return {
    title: `${name}'s live location`,
    text: `Follow ${name} live until ${formatTime(expiresAt, now, formats)}.`,
    url,
  }
}

/**
 * What to send for an asset's location: "Betty is at Storviltsgatan 5, Stockholm." when the fix is
 * fresh, "Betty was at … (14:05)." when it isn't, and a Google Maps link to the exact point.
 */
export function locationShare(
  name: string,
  location: AssetLocation,
  address: string | undefined,
  now: number,
  formats: Formats = defaultFormats,
): LocationShare {
  const fixTime = Date.parse(location.fixTime)
  const fresh = now - fixTime <= FRESH_MS
  const when = formatTime(fixTime, now, formats)

  let text: string
  if (fresh) text = address ? `${name} is at ${address}.` : `${name} is here:`
  else text = address ? `${name} was at ${address} (${when}).` : `${name} was here (${when}):`

  const point = `${location.lat.toFixed(6)},${location.lon.toFixed(6)}`
  return {
    title: `${name}'s location`,
    text,
    url: `https://www.google.com/maps/search/?api=1&query=${point}`,
  }
}
