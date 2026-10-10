import assert from 'node:assert/strict'
import { createECDH, createPublicKey, verify } from 'node:crypto'
import { describe, test } from 'node:test'
import { encryptPayload, isPushEndpoint, vapidAuthorization, vapidKeys } from './webPush.server.ts'

const b64 = (value: string) => Buffer.from(value.replace(/\s/g, ''), 'base64url')

describe('encryptPayload', () => {
  test("RFC 8291's example message, byte for byte", () => {
    // Appendix A and section 5 of RFC 8291.
    const body = encryptPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      { salt: b64('DGv6ra1nlYgDCS1FRnbzlw'), privateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') },
    )
    assert.equal(
      body.toString('base64url'),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
        'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
        'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  test('a fresh key and salt every time', () => {
    const browser = createECDH('prime256v1')
    browser.generateKeys()
    const target = { p256dh: browser.getPublicKey().toString('base64url'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' }
    assert.notDeepEqual(encryptPayload(Buffer.from('hi'), target), encryptPayload(Buffer.from('hi'), target))
  })
})

describe('VAPID', () => {
  const secret = 'a test secret that is at least 32 characters long'

  test('the key pair comes from the secret: the same secret, the same key', () => {
    assert.equal(vapidKeys(secret).publicKey.length, 65)
    assert.deepEqual(vapidKeys(secret).publicKey, vapidKeys(`${secret}`).publicKey)
    assert.notDeepEqual(vapidKeys(secret).publicKey, vapidKeys(`${secret}!`).publicKey)
  })

  test('a JWT for the push service, signed with that key', () => {
    const keys = vapidKeys(secret)
    const header = vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH', 'https://panopticon.example', keys, 1_800_000_000_000)
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    assert.ok(match)
    const [, head, body, signature, k] = match
    assert.deepEqual(JSON.parse(b64(body!).toString()), {
      aud: 'https://web.push.apple.com',
      exp: 1_800_000_000 + 12 * 3600,
      sub: 'https://panopticon.example',
    })
    assert.equal(k, keys.publicKey.toString('base64url'))
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: keys.publicKey.subarray(1, 33).toString('base64url'),
        y: keys.publicKey.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    })
    assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64(signature!)))
  })
})

test('only known push services, over https', () => {
  assert.ok(isPushEndpoint('https://web.push.apple.com/QGuQyavXutnMH'))
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'))
  assert.equal(isPushEndpoint('http://web.push.apple.com/x'), false)
  assert.equal(isPushEndpoint('https://traccar:8082/api/devices'), false)
  assert.equal(isPushEndpoint('https://push.apple.com.evil.example/x'), false)
  assert.equal(isPushEndpoint('not a url'), false)
})
