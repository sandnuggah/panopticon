import type { Asset } from '../lib/asset'
import { imageUrl } from './assets.server'
import { assetImageChanged } from './images.server'
import {
  createDevice,
  deleteDevice,
  deviceAttributes,
  getDevice,
  getDevices,
  getServerInfo,
  getUserAccess,
  tokenWasRejected,
  TraccarError,
  updateDevice,
  uploadDeviceImage,
  type TraccarDevice,
} from './traccar.server'

// Adding, renaming and removing assets, and changing their photos, through Traccar's device API.
// Traccar enforces who may do what; the access check here only decides which controls to show.

export type ManagedAsset = Pick<Asset, 'id' | 'name' | 'imageUrl' | 'trailColor'> & { disabled: boolean }

export type AssetAccess = {
  /** May rename, remove and change photos (Traccar's read-only settings are off). */
  canEdit: boolean
  /** May also add assets (and hasn't reached their device limit). */
  canAdd: boolean
}

export type EditError = 'not-allowed' | 'tracker-id-taken' | 'not-found' | 'invalid-image' | 'alerts-full' | 'unavailable'
export type EditResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: EditError }

export async function loadManagedAssets(token: string): Promise<{ access: AssetAccess; assets: ManagedAsset[] }> {
  const [devices, user, server] = await Promise.all([getDevices(token), getUserAccess(token), getServerInfo()])
  let access: AssetAccess = { canEdit: true, canAdd: true }
  if (!user.administrator) {
    // Mirrors Traccar's PermissionsService.checkEdit for devices, which also covers linking places to them.
    const canEdit = !server.readonly && !user.readonly && !server.deviceReadonly && !user.deviceReadonly
    const underLimit = user.deviceLimit < 0 || devices.length < user.deviceLimit
    access = { canEdit, canAdd: canEdit && underLimit }
  }
  const assets = devices.map(toManagedAsset).sort((a, b) => a.name.localeCompare(b.name))
  return { access, assets }
}

export async function loadManagedAsset(token: string, id: number): Promise<{ access: AssetAccess; asset: ManagedAsset } | null> {
  const { access, assets } = await loadManagedAssets(token)
  const asset = assets.find((candidate) => candidate.id === id)
  return asset ? { access, asset } : null
}

export function createAsset(token: string, name: string, trackerId: string): Promise<EditResult<{ id: number }>> {
  return attempt(token, async () => {
    const device = await createDevice(token, name, trackerId)
    return { ok: true, id: device.id }
  })
}

export function updateAssetName(token: string, id: number, name: string): Promise<EditResult> {
  return attempt(token, async () => {
    await updateDevice(token, id, (device) => {
      device.name = name
    })
    return { ok: true }
  })
}

export function deleteAsset(token: string, id: number): Promise<EditResult> {
  return attempt(token, async (): Promise<EditResult> => {
    const device = await getDevice(token, id)
    if (!device) return { ok: false, error: 'not-found' }
    await deleteDevice(token, id)
    assetImageChanged(id, device.uniqueId)
    return { ok: true }
  })
}

/** The colour its trail is drawn in (one of trailColors.ts's), stored on the device in Traccar, so it's the same everywhere. */
export function updateAssetTrailColor(token: string, id: number, color: string): Promise<EditResult> {
  return attempt(token, async () => {
    await updateDevice(token, id, (device) => {
      deviceAttributes(device).panopticonTrailColor = color
    })
    return { ok: true }
  })
}

/** Uploads the image to Traccar and makes it the asset's photo, as Traccar's own UI does. */
export function saveAssetImage(token: string, id: number, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<EditResult> {
  return attempt(token, async (): Promise<EditResult> => {
    const device = await getDevice(token, id)
    if (!device) return { ok: false, error: 'not-found' }
    const filename = await uploadDeviceImage(token, id, bytes, type)
    await updateDevice(token, id, (full) => {
      deviceAttributes(full).deviceImage = filename
    })
    assetImageChanged(id, device.uniqueId)
    return { ok: true }
  })
}

/** Stops using the photo. Traccar has no way to delete the file, so it stays in its media folder. */
export function clearAssetImage(token: string, id: number): Promise<EditResult> {
  return attempt(token, async () => {
    const device = await updateDevice(token, id, (full) => {
      delete deviceAttributes(full).deviceImage
    })
    assetImageChanged(id, device.uniqueId)
    return { ok: true }
  })
}

function toManagedAsset(device: TraccarDevice): ManagedAsset {
  const asset: ManagedAsset = { id: device.id, name: device.name, imageUrl: imageUrl(device), disabled: device.disabled }
  if (device.trailColor) asset.trailColor = device.trailColor
  return asset
}

/**
 * Runs a change and reports Traccar's refusals as results the page can explain. A rejected token is
 * rethrown so withToken signs the user out as usual.
 */
export async function attempt<T extends object>(token: string, call: () => Promise<EditResult<T>>): Promise<EditResult<T>> {
  try {
    return await call()
  } catch (error) {
    if (!(error instanceof TraccarError) || (await tokenWasRejected(token, error))) throw error
    const reason = editError(error)
    if (reason === 'unavailable') console.error('Asset change failed:', error.message)
    return { ok: false, error: reason }
  }
}

/** Traccar answers refusals with HTTP 400 and the exception's message in the body. */
function editError(error: TraccarError): EditError {
  if (error.status === 404) return 'not-found'
  if (/access denied|restricted|readonly|SecurityException/i.test(error.message)) return 'not-allowed'
  // The database's unique index on uniqueId: "Duplicate entry" (MySQL), "Unique index … violation" (H2).
  if (/duplicate|unique/i.test(error.message)) return 'tracker-id-taken'
  if (/image/i.test(error.message)) return 'invalid-image'
  return 'unavailable'
}
