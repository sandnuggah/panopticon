import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { locationShare } from './share.ts'

const now = Date.parse('2026-09-29T12:30:00Z')
const at = (minutesAgo: number) => ({ lat: 59.3577, lon: 18.0912, fixTime: new Date(now - minutesAgo * 60_000).toISOString() })
const formats = {
  time: new Intl.DateTimeFormat('sv-SE', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
  dateTime: new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
}

describe('locationShare', () => {
  test('a fresh fix is where the asset is', () => {
    const share = locationShare('Betty', at(1), 'Storviltsgatan 5, Stockholm', now, formats)
    assert.equal(share.title, "Betty's location")
    assert.equal(share.text, 'Betty is at Storviltsgatan 5, Stockholm.')
  })

  test('an older fix is where it was, with the time', () => {
    const share = locationShare('Betty', at(25), 'Storviltsgatan 5, Stockholm', now, formats)
    assert.equal(share.text, 'Betty was at Storviltsgatan 5, Stockholm (12:05).')
  })

  test('without an address, the link says where', () => {
    assert.equal(locationShare('Betty', at(1), undefined, now, formats).text, 'Betty is here:')
    assert.equal(locationShare('Betty', at(25), undefined, now, formats).text, 'Betty was here (12:05):')
  })

  test('links to the exact point', () => {
    const share = locationShare('Betty', at(1), undefined, now, formats)
    assert.equal(share.url, 'https://www.google.com/maps/search/?api=1&query=59.357700,18.091200')
  })
})
