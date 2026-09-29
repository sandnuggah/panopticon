import type { AssetLocation } from './asset'

// Sharing where an asset is, once, through the phone's share sheet: a sentence and a map link that
// opens for anyone, whatever phone they have. Live links that keep updating are a separate feature.

/** A fix older than this is shared as where the asset was, with the time. */
const FRESH_MS = 5 * 60 * 1000

export type LocationShare = { title: string; text: string; url: string }

type Formats = { time: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat }

const defaultFormats: Formats = {
  time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
  dateTime: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
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
  const sameDay = new Date(fixTime).toDateString() === new Date(now).toDateString()
  const when = (sameDay ? formats.time : formats.dateTime).format(fixTime)

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
