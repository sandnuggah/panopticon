import { createServerFn } from '@tanstack/react-start'
import { MAX_IMAGE_BYTES, sniffImageType } from '../lib/assetImage'
import {
  clearAssetImage,
  createAsset,
  deleteAsset,
  loadManagedAsset,
  loadManagedAssets,
  saveAssetImage,
  updateAssetName,
  type EditResult,
} from './manage.server'
import { withToken } from './session.server'

// Traccar stores names and tracker IDs in 128-character columns.
const MAX_LENGTH = 128

export const getManagedAssets = createServerFn({ method: 'GET' }).handler(() => withToken(loadManagedAssets))

export const getManagedAsset = createServerFn({ method: 'GET' })
  .validator(parseIdInput)
  .handler(({ data }) => withToken((token) => loadManagedAsset(token, data.id)))

export const addAsset = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { name, trackerId } = fields(input)
    return { name: parseName(name), trackerId: parseTrackerId(trackerId) }
  })
  .handler(({ data }) => withToken((token) => createAsset(token, data.name, data.trackerId)))

export const renameAsset = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: parseIdInput(input).id, name: parseName(fields(input).name) }))
  .handler(({ data }) => withToken((token) => updateAssetName(token, data.id, data.name)))

export const removeAsset = createServerFn({ method: 'POST' })
  .validator(parseIdInput)
  .handler(({ data }) => withToken((token) => deleteAsset(token, data.id)))

/** Takes FormData with `id` and `image` (already cropped and shrunk by the browser). */
export const uploadAssetImage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error('Invalid request')
    const image = input.get('image')
    if (!(image instanceof Blob)) throw new Error('Invalid request')
    return { id: parseId(Number(input.get('id'))), image }
  })
  .handler(({ data }) =>
    withToken(async (token): Promise<EditResult> => {
      if (data.image.size === 0 || data.image.size > MAX_IMAGE_BYTES) return { ok: false, error: 'invalid-image' }
      const bytes = new Uint8Array(await data.image.arrayBuffer())
      // Trust the bytes, not the type the browser declared.
      const type = sniffImageType(bytes)
      if (!type) return { ok: false, error: 'invalid-image' }
      return saveAssetImage(token, data.id, bytes, type)
    }),
  )

export const removeAssetImage = createServerFn({ method: 'POST' })
  .validator(parseIdInput)
  .handler(({ data }) => withToken((token) => clearAssetImage(token, data.id)))

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid request')
  return input as Record<string, unknown>
}

function parseIdInput(input: unknown): { id: number } {
  return { id: parseId(fields(input).id) }
}

function parseId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new Error('Invalid request')
  return id
}

function parseName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Invalid request')
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > MAX_LENGTH) throw new Error('Invalid request')
  return trimmed
}

/** Usually an IMEI or serial number: printable characters, no spaces. */
function parseTrackerId(trackerId: unknown): string {
  if (typeof trackerId !== 'string') throw new Error('Invalid request')
  const trimmed = trackerId.trim()
  if (!/^[\x21-\x7e]+$/.test(trimmed) || trimmed.length > MAX_LENGTH) throw new Error('Invalid request')
  return trimmed
}
