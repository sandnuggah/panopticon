import { DEFAULT_TRAIL_PROFILE, type TrailProfile } from './segments.ts'

// What the tracker itself is doing, for the Tracker section of an asset's page: whether it's
// connected, has a GPS fix, has signal and battery, and how often it reports. Built on the server
// from Traccar's device, its latest position and an hour of history (see tracker.server.ts);
// fetched when the page opens rather than streamed, so the map's data stays small. Only what the
// tracker reports is filled in. Never the tracker ID (IMEI) or SIM number.

export type SignalLevel = 'poor' | 'fair' | 'good' | 'excellent'

export type TrackerDetails = {
  status: 'online' | 'offline' | 'unknown'
  /** Last contact from the tracker (ISO time). */
  lastContact: string | null
  /**
   * The latest report's GPS: a fix, with how many satellites when known; or no fix, with when the
   * last one in the past hour was (null: none in the past hour). Null without any report.
   */
  gps: { fix: true; satellites?: number } | { fix: false; lastFix: string | null } | null
  /** Mobile signal on the modem scale (CSQ, 0–31) and what it amounts to, in 1–4 bars. */
  signal?: { csq: number; level: SignalLevel; bars: 1 | 2 | 3 | 4 }
  /** The mobile network, from the serving cell's country and network codes. */
  network?: { mcc: number; mnc: number; country?: string; operator?: string }
  battery?: { percent?: number; volts?: number }
  /** Typical time between reports over the past hour, in seconds. */
  reportEverySeconds?: number
  /** Where the last fix was. */
  position?: { lat: number; lon: number }
  model?: string
  /** Traccar's protocol name, e.g. h02 for SinoTrack. */
  protocol?: string
}

export const SIGNAL_LABELS: Record<SignalLevel, string> = {
  poor: 'Poor',
  fair: 'Fair',
  good: 'Good',
  excellent: 'Excellent',
}

/**
 * The kinds of tracker panopticon tells apart, by the protocol their positions come in (see
 * trackers.server.ts): SinoTrack (h02), a phone running Traccar Client (osmand), and the rest.
 */
export type TrackerKind = 'sinotrack' | 'phone' | 'standard'

/**
 * How the trail reads each kind of tracker's reports. SinoTrack's were tuned on an ST-904L's real
 * trips and walks (see segments.ts); the others start the same, until there's real data from one,
 * but tell a weak fix by its accuracy (a guess: over 50 m), since a satellite count means different
 * things from different receivers, and aren't known to stop reporting when still.
 */
const BY_ACCURACY: TrailProfile = { ...DEFAULT_TRAIL_PROFILE, weakSatellites: undefined, weakAccuracyMeters: 50, quietMs: undefined }
export const TRAIL_PROFILES: Record<TrackerKind, TrailProfile> = {
  sinotrack: DEFAULT_TRAIL_PROFILE,
  phone: BY_ACCURACY,
  standard: BY_ACCURACY,
}

/** Each asset's kind of tracker, by id, for the trail. */
export function trackersOf(assets: { id: number; tracker?: TrackerKind }[]): Record<number, TrackerKind | undefined> {
  return Object.fromEntries(assets.map((asset) => [asset.id, asset.tracker]))
}

/** The trail settings for an asset's tracker; the standard ones when it hasn't reported. */
export function trailProfile(kind: TrackerKind | undefined): TrailProfile {
  return TRAIL_PROFILES[kind ?? 'standard']
}
