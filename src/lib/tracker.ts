// What the tracker itself is doing, for the tracker details panel: whether it's connected, has a
// GPS fix, has signal and battery, and how often it reports. Built on the server from Traccar's
// device, its latest position and an hour of history (see tracker.server.ts); fetched when the
// panel opens rather than streamed, so the map's data stays small. Only what the tracker reports
// is filled in. Never the tracker ID (IMEI) or SIM number.

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
