import type { TrackerKind } from '../lib/tracker'
import type { TraccarPosition } from './traccar.server'

// Tracker adapters. Each kind of tracker reports what it knows in its own way: Traccar passes some of
// it on in its standard fields and attributes, and the rest as the protocol's own (SinoTrack's h02
// as unnamed io1–io8). An adapter, picked by the position's protocol, turns a position into one
// reading the rest of panopticon uses, and names the kind of tracker, whose trail settings the map
// uses (TRAIL_PROFILES in lib/tracker.ts). For a new kind of tracker, add an adapter here and a
// profile there. Only type imports, so Node can run the tests directly.

/** What a position says, whatever the tracker. Only what it reports is filled in. */
export type Reading = {
  /** How far off the fix may be, in metres, when the tracker says. */
  accuracy?: number
  satellites?: number
  /** The serving cell tower. */
  cell?: number
  /** The mobile network's country and network codes (MCC, MNC). */
  network?: { mcc: number; mnc: number }
  /** Mobile signal on the modem scale (CSQ, 0–31). */
  csq?: number
  battery?: { percent?: number; volts?: number }
}

/** More satellites than any receiver tracks at once. */
const MAX_SATELLITES = 64

type Adapter = { kind: TrackerKind; protocols: string[]; read: (position: TraccarPosition) => Reading }

const ADAPTERS: Adapter[] = [
  // SinoTrack (ST-904L and others), h02: the standard attributes, and what it sends unnamed after the
  // status field, checked against a day of real ST-904L reports:
  //   io1–io4  country code (MCC), network code (MNC), area and cell
  //   io5      satellites used for the fix (0 without one)
  //   io6      mobile signal on the modem scale (CSQ, 0–31, 99 unknown); 12–31 seen in Stockholm
  //   io7      battery voltage × 10 (35–38 seen)
  //   io8      battery percent (Traccar maps it to batteryLevel with a computed attribute)
  // It never reports accuracy (0).
  {
    kind: 'sinotrack',
    protocols: ['h02'],
    read: (position) => {
      const reading = standardReading(position)
      const attributes = position.attributes
      reading.satellites ??= satelliteCount(attributes.io5)
      if (reading.cell === undefined) {
        const cell = numberAttribute(attributes.io4)
        if (cell !== undefined && Number.isInteger(cell) && cell > 0) reading.cell = cell
      }
      if (!reading.network) {
        const [mcc, mnc] = [numberAttribute(attributes.io1), numberAttribute(attributes.io2)]
        if (mcc !== undefined && mnc !== undefined && mcc > 0) reading.network = { mcc, mnc }
      }
      const csq = numberAttribute(attributes.io6)
      if (csq !== undefined && csq >= 0 && csq <= 31) reading.csq = csq
      const volts = numberAttribute(attributes.io7)
      if (reading.battery?.volts === undefined && volts !== undefined && volts > 0) {
        reading.battery = { ...reading.battery, volts: volts / 10 }
      }
      return dropEmpty(reading)
    },
  },
  // A phone running Traccar Client (osmand): the standard fields, with the fix's accuracy.
  { kind: 'phone', protocols: ['osmand'], read: (position) => dropEmpty(standardReading(position)) },
]

/** Any other tracker: Traccar's standard fields and attributes. */
const STANDARD: Adapter = { kind: 'standard', protocols: [], read: (position) => dropEmpty(standardReading(position)) }

/** The adapter for a tracker by the protocol its positions come in (null: it hasn't reported). */
export function adapterFor(protocol: string | null | undefined): Adapter {
  return ADAPTERS.find((adapter) => protocol && adapter.protocols.includes(protocol)) ?? STANDARD
}

/** A position as panopticon reads it, whatever the tracker. */
export function readPosition(position: TraccarPosition): Reading {
  return adapterFor(position.protocol).read(position)
}

function standardReading(position: TraccarPosition): Reading {
  const attributes = position.attributes
  const reading: Reading = {}
  if (position.accuracy > 0) reading.accuracy = position.accuracy
  const satellites = satelliteCount(attributes.sat)
  if (satellites !== undefined) reading.satellites = satellites
  if (position.cellId !== null) reading.cell = position.cellId
  if (position.cellNetwork) reading.network = { ...position.cellNetwork }
  const percent = numberAttribute(attributes.batteryLevel)
  const volts = numberAttribute(attributes.battery)
  if (percent !== undefined || volts !== undefined) {
    reading.battery = {}
    if (percent !== undefined) reading.battery.percent = percent
    if (volts !== undefined) reading.battery.volts = volts
  }
  return reading
}

function dropEmpty(reading: Reading): Reading {
  if (reading.battery && reading.battery.percent === undefined && reading.battery.volts === undefined) delete reading.battery
  return reading
}

/** A count of satellites, or undefined for a value no receiver gives (an ST-904L once sent about 9×10¹⁹). */
function satelliteCount(value: unknown): number | undefined {
  const count = numberAttribute(value)
  return count !== undefined && Number.isInteger(count) && count >= 0 && count <= MAX_SATELLITES ? count : undefined
}

/** Traccar stores h02's extra values as text; standard attributes are numbers. */
function numberAttribute(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}
