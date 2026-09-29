import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// Live location links (/s/<link>) carry what's needed to show one asset without signing in: its
// id, a Traccar token that expires with the link, and that expiry, sealed with AES-256-GCM under a
// key derived from SESSION_SECRET. Nothing is stored; the token never reaches the viewer's
// browser, and a link can't be read, edited or forged without the secret. Only node:crypto here,
// so Node can run its tests directly.

export type ShareLinkData = {
  assetId: number
  /** A Traccar token for the sharer's account, expiring with the link. */
  token: string
  /** ms since epoch. */
  expiresAt: number
}

/** First byte of every link, so the format can change later without misreading old links. */
const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

/** A key of its own, separate from the session cookie's, derived from the same secret. */
function key(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'panopticon', 'share-link-v1', 32))
}

export function sealShareLink(data: ShareLinkData, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(Buffer.from([VERSION]))
  const payload = JSON.stringify({ a: data.assetId, t: data.token, e: data.expiresAt })
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString('base64url')
}

/** The link's contents, or null when it isn't one of ours (malformed, edited, or another secret). */
export function unsealShareLink(link: string, secret: string): ShareLinkData | null {
  if (!/^[A-Za-z0-9_-]{40,2000}$/.test(link)) return null
  const bytes = Buffer.from(link, 'base64url')
  if (bytes.length <= 1 + IV_BYTES + TAG_BYTES || bytes[0] !== VERSION) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(1, 1 + IV_BYTES))
    decipher.setAAD(Buffer.from([VERSION]))
    decipher.setAuthTag(bytes.subarray(-TAG_BYTES))
    const plain = Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES, -TAG_BYTES)), decipher.final()])
    const { a, t, e } = JSON.parse(plain.toString('utf8')) as Record<string, unknown>
    if (!Number.isInteger(a) || (a as number) <= 0 || typeof t !== 'string' || t === '' || !Number.isFinite(e)) {
      return null
    }
    return { assetId: a as number, token: t, expiresAt: e as number }
  } catch {
    return null
  }
}
