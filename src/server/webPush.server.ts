import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto'

// Web Push (RFC 8030) from panopticon's server: the message encrypted for the phone (RFC 8291,
// aes128gcm) and signed with the server's key (VAPID, RFC 8292), posted to the push service the
// phone subscribed with (Apple's, Google's, Mozilla's). Only node:crypto, so there's no dependency
// and Node can run the tests directly.

/** A browser's push subscription: where to post, and its keys (base64url), from PushSubscription.toJSON(). */
export type PushTarget = { endpoint: string; p256dh: string; auth: string }

export type PushResult = 'sent' | 'gone' | 'failed'

/** Push services panopticon posts to. Anything else is refused: the endpoint comes from the browser, and this keeps the server from posting to other addresses. */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return url.protocol === 'https:' && endpoint.length <= 1000 && PUSH_HOSTS.some((host) => host.test(url.hostname))
}

/** P-256's group order: a private key must be below it. */
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

type VapidKeys = { publicKey: Buffer; privateKey: KeyObject }
let cachedKeys: { secret: string; keys: VapidKeys } | undefined

/**
 * The server's VAPID key pair, derived from SESSION_SECRET, so there's no key to configure or
 * store. Changing the secret changes the key, and phones then have to turn alerts on again.
 */
export function vapidKeys(secret: string): VapidKeys {
  if (cachedKeys?.secret === secret) return cachedKeys.keys
  let d: Buffer
  for (let attempt = 0; ; attempt++) {
    d = Buffer.from(hkdfSync('sha256', secret, 'panopticon', `web-push-vapid-v1-${attempt}`, 32))
    const value = BigInt(`0x${d.toString('hex')}`)
    if (value > 0n && value < P256_ORDER) break
  }
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(d)
  const publicKey = ecdh.getPublicKey()
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString('base64url'),
      x: publicKey.subarray(1, 33).toString('base64url'),
      y: publicKey.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  })
  const keys = { publicKey, privateKey }
  cachedKeys = { secret, keys }
  return keys
}

/** The Authorization header for a push service: a JWT for its origin, valid 12 hours, signed with the VAPID key. */
export function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, now = Date.now()): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`
  const signature = sign('sha256', Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey.toString('base64url')}`
}

/**
 * Encrypts a message for one subscription (RFC 8291): an ECDH key agreement with the browser's
 * key, mixed with its auth secret, gives the AES-128-GCM key and nonce; the body is one record,
 * after a header with the salt and the server's one-off public key. `fixed` is for the tests.
 */
export function encryptPayload(
  payload: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { salt: Buffer; privateKey: Buffer },
): Buffer {
  const browserKey = Buffer.from(target.p256dh, 'base64url')
  const authSecret = Buffer.from(target.auth, 'base64url')
  const ecdh = createECDH('prime256v1')
  if (fixed) ecdh.setPrivateKey(fixed.privateKey)
  else ecdh.generateKeys()
  const serverKey = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(browserKey)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const salt = fixed?.salt ?? randomBytes(16)
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  // 0x02: the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  return Buffer.concat([salt, recordSize, Buffer.from([serverKey.length]), serverKey, body])
}

/**
 * Sends one push message. 'gone' when the push service says the subscription no longer exists
 * (the phone turned alerts off, or the app was removed), so it can be dropped.
 */
export async function sendPush(target: PushTarget, message: object, subject: string, secret: string): Promise<PushResult> {
  if (!isPushEndpoint(target.endpoint)) return 'gone'
  try {
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(target.endpoint, subject, vapidKeys(secret)),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // Kept for a day if the phone is off; delivered at once when it's on.
        TTL: String(24 * 3600),
        Urgency: 'high',
      },
      body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(message)), target)),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return 'sent'
    if (response.status === 404 || response.status === 410) return 'gone'
    const reason = (await response.text().catch(() => '')).split('\n', 1)[0]!.slice(0, 200)
    console.warn(`Push to ${new URL(target.endpoint).hostname} failed with HTTP ${response.status}: ${reason}`)
    return 'failed'
  } catch (error) {
    console.warn(`Push to ${new URL(target.endpoint).hostname} failed:`, error instanceof Error ? error.message : error)
    return 'failed'
  }
}
