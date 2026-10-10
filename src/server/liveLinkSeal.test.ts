import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { sealLiveLink, unsealLiveLink } from './liveLinkSeal.server.ts'

const secret = 'a-test-secret-that-is-at-least-32-characters'
const data = { assetId: 30, token: 'eyJ0b2tlbiI6InNpZ25lZCJ9.c2lnbmF0dXJl', expiresAt: Date.parse('2026-09-29T20:30:00Z') }

describe('share links', () => {
  test('unseal what was sealed', () => {
    const link = sealLiveLink(data, secret)
    assert.match(link, /^[A-Za-z0-9_-]+$/)
    assert.deepEqual(unsealLiveLink(link, secret), data)
  })

  test('the token is not readable in the link', () => {
    const link = sealLiveLink(data, secret)
    assert.ok(!Buffer.from(link, 'base64url').toString('latin1').includes('signed'))
    assert.ok(!link.includes(data.token))
  })

  test('the same data seals differently each time', () => {
    assert.notEqual(sealLiveLink(data, secret), sealLiveLink(data, secret))
  })

  test('an edited link is refused', () => {
    const bytes = Buffer.from(sealLiveLink(data, secret), 'base64url')
    for (const index of [0, 5, 20, bytes.length - 1]) {
      const edited = Buffer.from(bytes)
      edited[index]! ^= 1
      assert.equal(unsealLiveLink(edited.toString('base64url'), secret), null, `byte ${index}`)
    }
  })

  test('another secret is refused', () => {
    assert.equal(unsealLiveLink(sealLiveLink(data, secret), `${secret}-rotated`), null)
  })

  test('anything else is refused', () => {
    for (const link of ['', 'abc', 'not a link!', 'A'.repeat(100), 'A'.repeat(3000)]) {
      assert.equal(unsealLiveLink(link, secret), null, link.slice(0, 10))
    }
  })
})
