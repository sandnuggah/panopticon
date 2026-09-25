import type { Asset } from '../lib/asset'
import {
  getDevices,
  getLatestPositions,
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

export function toAsset(device: TraccarDevice, position: TraccarPosition | undefined): Asset {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    lastUpdate: device.lastUpdate,
    location: position
      ? {
          lat: position.latitude,
          lon: position.longitude,
          accuracy: position.accuracy > 0 ? position.accuracy : undefined,
          fixTime: position.fixTime,
        }
      : null,
    battery: position ? readBattery(position.attributes) : undefined,
  }
}

function readBattery(attributes: Record<string, unknown>): Asset['battery'] {
  const percent = typeof attributes.batteryLevel === 'number' ? attributes.batteryLevel : undefined
  const volts = typeof attributes.battery === 'number' ? attributes.battery : undefined
  return percent === undefined && volts === undefined ? undefined : { percent, volts }
}
