import { createHash } from 'node:crypto'
import { getSessionToken } from './session.server'
import { getDevice, getDeviceImage, tokenWasRejected } from './traccar.server'

// GET /images/asset/<id>: the image uploaded for a device in Traccar's UI. The browser only knows
// the asset id; the device's uniqueId (often an IMEI) stays on the server.

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Fetching an image costs Traccar a session, so keep them a few minutes. */
const CACHE_MS = 5 * 60 * 1000
const MAX_CACHED = 50

type Cached = { bytes: ArrayBuffer; contentType: string; etag: string; expires: number }
const cache = new Map<string, Cached>()

export async function assetImageResponse(request: Request, idParam: string): Promise<Response> {
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) return new Response('Not found', { status: 404 })

  const token = await getSessionToken()
  if (!token) return new Response('Not signed in', { status: 401 })

  try {
    // Also Traccar's permission check: only devices this user may see are returned.
    const device = await getDevice(token, id)
    if (!device?.image) return new Response('Not found', { status: 404 })

    const image = await cachedImage(token, device.uniqueId, device.image)
    if (!image) return new Response('Not found', { status: 404 })

    const headers = {
      'Content-Type': image.contentType,
      ETag: image.etag,
      // Per user, and short: a new upload in Traccar keeps the same filename.
      'Cache-Control': 'private, max-age=300',
    }
    if (request.headers.get('If-None-Match') === image.etag) {
      return new Response(null, { status: 304, headers })
    }
    return new Response(image.bytes, { headers })
  } catch (error) {
    if (await tokenWasRejected(token, error)) return new Response('Not signed in', { status: 401 })
    console.warn(`Could not load image for asset ${id}:`, error instanceof Error ? error.message : error)
    return new Response('Image unavailable', { status: 502 })
  }
}

async function cachedImage(token: string, uniqueId: string, filename: string): Promise<Cached | null> {
  const key = `${uniqueId}/${filename}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit

  const bytes = await getDeviceImage(token, uniqueId, filename)
  if (!bytes) {
    cache.delete(key)
    return null
  }
  const extension = filename.slice(filename.lastIndexOf('.') + 1)
  const entry: Cached = {
    bytes,
    // From the extension Traccar chose, not from its response, so it's always an image type.
    contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
    etag: `"${createHash('sha256').update(new Uint8Array(bytes)).digest('base64url').slice(0, 22)}"`,
    expires: Date.now() + CACHE_MS,
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(key, entry)
  return entry
}
