import type { SignalLevel, TrackerDetails } from '../lib/tracker'
import type { TraccarDevice, TraccarPosition } from './traccar.server'
import { readPosition } from './trackers.server.ts'

// Tracker details from Traccar's data (see lib/tracker.ts), read the same way whatever the tracker
// (see trackers.server.ts). No runtime imports beyond trackers.server.ts, so Node can run the tests
// directly.

/** Countries by mobile country code, for the ones this is likely to meet. */
const COUNTRIES: Record<number, string> = { 238: 'Denmark', 240: 'Sweden', 242: 'Norway', 244: 'Finland' }
/** Swedish operators by mobile network code. */
const OPERATORS: Record<string, string> = { '240-01': 'Telia', '240-02': 'Tre', '240-07': 'Tele2', '240-08': 'Telenor' }

/**
 * `latest` is the device's latest position, `history` its reports from the past hour (any order).
 */
export function toTrackerDetails(device: TraccarDevice, latest: TraccarPosition | undefined, history: TraccarPosition[]): TrackerDetails {
  const details: TrackerDetails = { status: device.status, lastContact: device.lastUpdate, gps: null }
  if (device.model) details.model = device.model
  if (!latest) return details

  const reading = readPosition(latest)
  if (latest.protocol) details.protocol = latest.protocol

  const satellites = reading.satellites
  if (latest.valid) {
    details.gps = satellites !== undefined ? { fix: true, satellites } : { fix: true }
  } else {
    const lastFix = history
      .filter((position) => position.valid)
      .map((position) => position.fixTime)
      .sort()
      .at(-1)
    details.gps = { fix: false, lastFix: lastFix ?? null }
  }

  if (reading.csq !== undefined) details.signal = signal(reading.csq)

  const network = reading.network
  if (network) {
    details.network = { ...network }
    const country = COUNTRIES[network.mcc]
    const operator = OPERATORS[`${network.mcc}-${String(network.mnc).padStart(2, '0')}`]
    if (country) details.network.country = country
    if (operator) details.network.operator = operator
  }

  if (reading.battery) details.battery = { ...reading.battery }

  const every = typicalGapSeconds(history)
  if (every !== undefined) details.reportEverySeconds = every

  details.position = { lat: latest.latitude, lon: latest.longitude }
  return details
}

/** The modem's usual reading of CSQ: under 10 poor, 10–14 fair, 15–19 good, 20 and up excellent. */
function signal(csq: number): NonNullable<TrackerDetails['signal']> {
  const [level, bars]: [SignalLevel, 1 | 2 | 3 | 4] =
    csq < 10 ? ['poor', 1] : csq < 15 ? ['fair', 2] : csq < 20 ? ['good', 3] : ['excellent', 4]
  return { csq, level, bars }
}

/** The median time between consecutive reports, rounded: to 5 s under a minute, else to minutes. */
function typicalGapSeconds(history: TraccarPosition[]): number | undefined {
  const times = history.map((position) => Date.parse(position.fixTime)).sort((a, b) => a - b)
  const gaps = times
    .slice(1)
    .map((time, index) => (time - times[index]!) / 1000)
    .filter((gap) => gap > 0)
  if (gaps.length < 3) return undefined
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]!
  return median < 60 ? Math.max(5, Math.round(median / 5) * 5) : Math.round(median / 60) * 60
}
