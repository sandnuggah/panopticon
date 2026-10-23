import type { Asset } from './asset'
import type { Presence } from './presence'
import type { Activity, Stay } from './segments'

// What an asset is up to, in a word, for its card, marker and the bottom bar. A tracker that sleeps
// when still (an ST-904L at home sends nothing for hours) isn't lost: only silence that doesn't fit
// what it was doing greys it out. Until October 2026 every asset went grey 30 minutes after its last
// fix, which on a week of Kofi's was 74% of the time, nearly all of it asleep at home.

export type AssetStatus =
  /** No location yet. */
  | { kind: 'unknown' }
  | { kind: 'moving' }
  /** Staying put: at one of its places (`place`), or somewhere else. */
  | { kind: 'resting'; place: number | null }
  /** Out, still reporting, but without GPS since `since` (indoors, underground). */
  | { kind: 'no-gps'; since: number }
  /** Nothing from the tracker since `since`, for longer than fits what it was doing. */
  | { kind: 'lost'; since: number }

/** Out and about, a tracker reports every few seconds or minutes: silent this long, it's lost. */
const LOST_OUT_MS = 30 * 60 * 1000
/** Resting, it may sleep for most of a day (19.9 hours at home, once, on a week of Kofi's). */
const LOST_RESTING_MS = 24 * 60 * 60 * 1000
/** Reports without a fix for this long, while out: no GPS. */
const NO_GPS_MS = 5 * 60 * 1000

/**
 * What the asset is up to as of `now`, from its latest report and fix, where it is as its places go
 * (`presence`), whether it's staying put somewhere else (`stay`), and whether it's riding (`activity`).
 */
export function assetStatus(
  asset: Pick<Asset, 'location' | 'lastUpdate'>,
  { presence, stay, activity }: { presence?: Presence; stay?: Stay; activity?: Activity },
  now: number,
): AssetStatus {
  if (!asset.location) return { kind: 'unknown' }
  const fix = Date.parse(asset.location.fixTime)
  const contact = Math.max(fix, asset.lastUpdate ? Date.parse(asset.lastUpdate) : 0)
  const resting = !activity && (presence?.place != null || stay !== undefined)
  if (now - contact > (resting ? LOST_RESTING_MS : LOST_OUT_MS)) return { kind: 'lost', since: contact }
  // Indoors at a place, reports without a fix are no news: it's resting there.
  if (resting) return { kind: 'resting', place: presence?.place ?? null }
  if (contact - fix >= NO_GPS_MS) return { kind: 'no-gps', since: fix }
  return { kind: 'moving' }
}

/** Whether to grey the asset out: lost, or never located. */
export function isGrey(status: AssetStatus): boolean {
  return status.kind === 'lost' || status.kind === 'unknown'
}
