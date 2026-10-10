import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sealAlerts, unsealAlerts, type AlertEntry } from './alertsSeal.server.ts'

const secret = 'a test secret that is at least 32 characters long'
const entry: AlertEntry = {
  endpoint: 'https://web.push.apple.com/QGuQyavXutnMH',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  origin: 'https://panopticon.example',
  timeZone: 'Europe/Stockholm',
  locale: 'sv-SE',
  rules: ['leave:4', 'offline'],
}

test('sealed alerts read back for the same device and secret', () => {
  assert.deepEqual(unsealAlerts(sealAlerts([entry], 30, secret), 30, secret), [entry])
})

test("not for another device, another secret, or when edited: they're ignored", () => {
  const sealed = sealAlerts([entry], 30, secret)
  assert.deepEqual(unsealAlerts(sealed, 31, secret), [])
  assert.deepEqual(unsealAlerts(sealed, 30, `${secret}!`), [])
  const edited = sealed.slice(0, 40) + (sealed[40] === 'A' ? 'B' : 'A') + sealed.slice(41)
  assert.deepEqual(unsealAlerts(edited, 30, secret), [])
  assert.deepEqual(unsealAlerts(undefined, 30, secret), [])
  assert.deepEqual(unsealAlerts('hello', 30, secret), [])
})

test('one phone with a few places fits comfortably in a device attribute', () => {
  const rules: AlertEntry['rules'] = ['leave:1', 'arrive:1', 'leave:2', 'arrive:2', 'leave:3', 'arrive:3', 'offline']
  const endpoint = `https://fcm.googleapis.com/fcm/send/${'x'.repeat(160)}`
  assert.ok(sealAlerts([{ ...entry, endpoint, rules }], 30, secret).length < 700)
})
