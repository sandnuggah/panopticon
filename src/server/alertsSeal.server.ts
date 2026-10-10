import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { isAlertRule, type AlertRule } from '../lib/alerts.ts'

// Which phones want which alerts for an asset, kept on the asset itself: a Traccar device
// attribute, sealed with AES-256-GCM under a key derived from SESSION_SECRET. Traccar forwards
// events with the device and its attributes, so panopticon can send the alerts without storing
// anything or holding a Traccar login. Sealed because a push subscription lets anyone who has it
// send that phone notifications, and Traccar shows device attributes to everyone who can see the
// device. Tied to the device's id, so it can't be copied to another one.

/** One phone's alerts for one asset. */
export type AlertEntry = {
  /** The phone's push subscription (see webPush.server.ts). */
  endpoint: string
  p256dh: string
  auth: string
  /** Where panopticon is, as the phone opened it: the VAPID subject, and where tapping an alert goes. */
  origin: string
  /** The phone's time zone and language, for the time in the alert. */
  timeZone: string
  locale: string
  rules: AlertRule[]
}

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'panopticon', 'alerts-v1', 32))
}

function aad(deviceId: number): Buffer {
  return Buffer.concat([Buffer.from([VERSION]), Buffer.from(String(deviceId))])
}

export function sealAlerts(entries: AlertEntry[], deviceId: number, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAAD(aad(deviceId))
  // Short keys: Traccar keeps a device's attributes in a limited column.
  const payload = JSON.stringify(
    entries.map((entry) => ({
      e: entry.endpoint,
      k: entry.p256dh,
      a: entry.auth,
      o: entry.origin,
      z: entry.timeZone,
      l: entry.locale,
      r: entry.rules,
    })),
  )
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]).toString('base64url')
}

/** The entries, or none when the value isn't one of ours for this device (edited, another secret, another device). */
export function unsealAlerts(value: unknown, deviceId: number, secret: string): AlertEntry[] {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{30,20000}$/.test(value)) return []
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length <= 1 + IV_BYTES + TAG_BYTES || bytes[0] !== VERSION) return []
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), bytes.subarray(1, 1 + IV_BYTES))
    decipher.setAAD(aad(deviceId))
    decipher.setAuthTag(bytes.subarray(-TAG_BYTES))
    const plain = Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES, -TAG_BYTES)), decipher.final()])
    const list: unknown = JSON.parse(plain.toString('utf8'))
    if (!Array.isArray(list)) return []
    return list.flatMap((item: Record<string, unknown>) => {
      const strings = [item.e, item.k, item.a, item.o, item.z, item.l]
      if (!strings.every((field) => typeof field === 'string') || !Array.isArray(item.r)) return []
      return [
        {
          endpoint: item.e as string,
          p256dh: item.k as string,
          auth: item.a as string,
          origin: item.o as string,
          timeZone: item.z as string,
          locale: item.l as string,
          rules: item.r.filter(isAlertRule),
        },
      ]
    })
  } catch {
    return []
  }
}
