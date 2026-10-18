import type { Asset, AssetLocation } from '../lib/asset'
import type { LiveUpdate } from '../lib/live'
import type { TrailPoint, Trails } from '../lib/trail'
import { assetImageVersion } from './images.server'
import {
  getDevices,
  getLatestPositions,
  getPositionHistory,
  TraccarError,
  type TraccarDevice,
  type TraccarPosition,
} from './traccar.server'

export async function loadAssets(token: string): Promise<Asset[]> {
  const [devices, positions] = await Promise.all([getDevices(token), getLatestPositions(token)])
  const positionByDevice = new Map(positions.map((position) => [position.deviceId, position]))
  return devices
    .filter((device) => !device.disabled)
    .map((device) => toAsset(device, positionByDevice.get(device.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Reports from the last `minutes`, per asset, including those without a GPS fix: they're evidence
 * of travel without GPS (see segments.ts). An asset whose history fails just gets no trail.
 */
export async function loadTrails(token: string, assetIds: number[], minutes: number): Promise<Trails> {
  const to = new Date()
  const from = new Date(to.getTime() - minutes * 60 * 1000)
  const results = await Promise.allSettled(assetIds.map((id) => getPositionHistory(token, id, from, to)))
  const trails: Trails = {}
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      // A rejected token should sign the user out like any other call; other failures only cost the trail.
      if (result.reason instanceof TraccarError && result.reason.status === 401) throw result.reason
      console.warn(`No trail for asset ${assetIds[index]}:`, String(result.reason))
      return
    }
    trails[assetIds[index]!] = result.value.map(toTrailPoint).sort((a, b) => a.time - b.time)
  })
  return trails
}

export function toAsset(device: TraccarDevice, position: TraccarPosition | undefined): Asset {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    lastUpdate: device.lastUpdate,
    location: position ? toLocation(position) : null,
    battery: position ? readBattery(position.attributes) : undefined,
    imageUrl: imageUrl(device),
    placeIds: position?.geofenceIds ?? [],
  }
}

export function toDeviceUpdate(device: TraccarDevice): LiveUpdate {
  return {
    kind: 'device',
    id: device.id,
    name: device.name,
    status: device.status,
    lastUpdate: device.lastUpdate,
    disabled: device.disabled,
    imageUrl: imageUrl(device),
  }
}

/** The filename and panopticon's own upload version go in the query, so a new image gets a fresh URL. */
export function imageUrl(device: TraccarDevice): string | undefined {
  if (!device.image) return undefined
  const version = assetImageVersion(device.id)
  return `/images/asset/${device.id}?v=${device.image}${version ? `-${version}` : ''}`
}

export function toPositionUpdate(position: TraccarPosition): LiveUpdate {
  const update: LiveUpdate = {
    kind: 'position',
    id: position.deviceId,
    location: toLocation(position),
    battery: readBattery(position.attributes),
    valid: position.valid,
    placeIds: position.geofenceIds,
  }
  const cell = readCell(position)
  if (cell !== undefined) update.cell = cell
  return update
}

export function toTrailPoint(position: TraccarPosition): TrailPoint {
  const point: TrailPoint = {
    lat: position.latitude,
    lon: position.longitude,
    time: Date.parse(position.fixTime),
    valid: position.valid,
  }
  const cell = readCell(position)
  if (cell !== undefined) point.cell = cell
  return point
}

/**
 * The serving cell tower. Traccar's `network` has it for many protocols; SinoTrack's h02 instead
 * sends it unnamed after the status field, where io1–io4 are country, operator, area and cell.
 */
function readCell(position: TraccarPosition): number | undefined {
  if (position.cellId !== null) return position.cellId
  if (position.protocol !== 'h02') return undefined
  const cell = Number(position.attributes.io4)
  return Number.isInteger(cell) && cell > 0 ? cell : undefined
}

function toLocation(position: TraccarPosition): AssetLocation {
  return {
    lat: position.latitude,
    lon: position.longitude,
    accuracy: position.accuracy > 0 ? position.accuracy : undefined,
    fixTime: position.fixTime,
  }
}

function readBattery(attributes: Record<string, unknown>): Asset['battery'] {
  const percent = typeof attributes.batteryLevel === 'number' ? attributes.batteryLevel : undefined
  const volts = typeof attributes.battery === 'number' ? attributes.battery : undefined
  return percent === undefined && volts === undefined ? undefined : { percent, volts }
}
