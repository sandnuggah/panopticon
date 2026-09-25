import type { Pet } from '../lib/pet'
import {
  getDevices,
  getLatestPositions,
  type TraccarDevice,
  type TraccarPosition,
} from './traccar.server'

export async function loadPets(token: string): Promise<Pet[]> {
  const [devices, positions] = await Promise.all([getDevices(token), getLatestPositions(token)])
  const positionByDevice = new Map(positions.map((position) => [position.deviceId, position]))
  return devices
    .filter((device) => !device.disabled)
    .map((device) => toPet(device, positionByDevice.get(device.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function toPet(device: TraccarDevice, position: TraccarPosition | undefined): Pet {
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

function readBattery(attributes: Record<string, unknown>): Pet['battery'] {
  const percent = typeof attributes.batteryLevel === 'number' ? attributes.batteryLevel : undefined
  const volts = typeof attributes.battery === 'number' ? attributes.battery : undefined
  return percent === undefined && volts === undefined ? undefined : { percent, volts }
}
