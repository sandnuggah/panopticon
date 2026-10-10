import type { SignalLevel, TrackerDetails } from '../lib/tracker'
import type { TraccarDevice, TraccarPosition } from './traccar.server'

// Tracker details from Traccar's data (see lib/tracker.ts). Traccar's standard attributes come
// first; SinoTrack trackers (protocol h02) send their extra values unnamed after the status field,
// which Traccar stores as io1–io8. On an ST-904L, checked against a day of real reports:
//   io1–io4  country code (MCC), network code (MNC), area and cell
//   io5      satellites used for the fix (0 without one)
//   io6      mobile signal on the modem scale (CSQ, 0–31, 99 unknown); 12–31 seen in Stockholm
//   io7      battery voltage × 10 (35–38 seen)
//   io8      battery percent (Traccar maps it to batteryLevel with a computed attribute)
// Only type imports here, so Node can run the tests directly.

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

  const attributes = latest.attributes
  const h02 = latest.protocol === 'h02'
  if (latest.protocol) details.protocol = latest.protocol

  const satellites = numberAttribute(attributes.sat) ?? (h02 ? numberAttribute(attributes.io5) : undefined)
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

  const csq = h02 ? numberAttribute(attributes.io6) : undefined
  if (csq !== undefined && csq >= 0 && csq <= 31) details.signal = signal(csq)

  const network = latest.cellNetwork ?? (h02 ? h02Network(attributes) : null)
  if (network) {
    details.network = { ...network }
    const country = COUNTRIES[network.mcc]
    const operator = OPERATORS[`${network.mcc}-${String(network.mnc).padStart(2, '0')}`]
    if (country) details.network.country = country
    if (operator) details.network.operator = operator
  }

  const percent = numberAttribute(attributes.batteryLevel)
  const volts = numberAttribute(attributes.battery) ?? (h02 ? tenths(attributes.io7) : undefined)
  if (percent !== undefined || volts !== undefined) {
    details.battery = {}
    if (percent !== undefined) details.battery.percent = percent
    if (volts !== undefined) details.battery.volts = volts
  }

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

function h02Network(attributes: Record<string, unknown>): { mcc: number; mnc: number } | null {
  const mcc = numberAttribute(attributes.io1)
  const mnc = numberAttribute(attributes.io2)
  return mcc !== undefined && mnc !== undefined && mcc > 0 ? { mcc, mnc } : null
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

/** Traccar stores h02's extra values as text; standard attributes are numbers. */
function numberAttribute(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}

function tenths(value: unknown): number | undefined {
  const number = numberAttribute(value)
  return number === undefined || number <= 0 ? undefined : number / 10
}
