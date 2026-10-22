import type { AssetLocation } from '../lib/asset'
import type { LiveUpdate } from '../lib/live'
import type { TrailPoint } from '../lib/trail'
import { adapterFor, readPosition } from './trackers.server'
import type { TraccarPosition } from './traccar.server'

// A Traccar position as panopticon uses it: a live update, a point on the trail, a location. Only type
// imports beyond the tracker adapters, so Node can run the trail replay (dev/replay.ts) with these.

export function toPositionUpdate(position: TraccarPosition): LiveUpdate {
  const reading = readPosition(position)
  const update: LiveUpdate = {
    kind: 'position',
    id: position.deviceId,
    location: toLocation(position),
    battery: reading.battery,
    valid: position.valid,
    placeIds: position.geofenceIds,
    tracker: adapterFor(position.protocol).kind,
  }
  if (reading.cell !== undefined) update.cell = reading.cell
  if (reading.satellites !== undefined) update.satellites = reading.satellites
  return update
}

export function toTrailPoint(position: TraccarPosition): TrailPoint {
  const reading = readPosition(position)
  const point: TrailPoint = {
    lat: position.latitude,
    lon: position.longitude,
    time: Date.parse(position.fixTime),
    valid: position.valid,
  }
  // The serving cell tower: evidence of travel without GPS; how good the fix is (see segments.ts).
  if (reading.cell !== undefined) point.cell = reading.cell
  if (reading.satellites !== undefined) point.satellites = reading.satellites
  if (reading.accuracy !== undefined) point.accuracy = reading.accuracy
  return point
}

export function toLocation(position: TraccarPosition): AssetLocation {
  return {
    lat: position.latitude,
    lon: position.longitude,
    accuracy: readPosition(position).accuracy,
    fixTime: position.fixTime,
  }
}
