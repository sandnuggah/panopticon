import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseCredit } from './credits.ts'

describe('parseCredit', () => {
  test("OpenFreeMap's credit: three links with text between", () => {
    const html =
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
    assert.deepEqual(parseCredit(html), [
      { text: 'OpenFreeMap', href: 'https://openfreemap.org' },
      { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
      { text: 'Data from' },
      { text: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
    ])
  })

  test('plain text stays text, with entities decoded', () => {
    assert.deepEqual(parseCredit('&copy; My tiles &amp; data &#169; &#xA9;'), [{ text: '© My tiles & data © ©' }])
  })

  test('only http(s) links are kept; any other link is just its text', () => {
    assert.deepEqual(parseCredit('<a href="javascript:alert(1)">Click</a>'), [{ text: 'Click' }])
    assert.deepEqual(parseCredit('<a href=" JaVaScRiPt:alert(1)">Click</a>'), [{ text: 'Click' }])
    assert.deepEqual(parseCredit("<a href='data:text/html,x'>Data</a>"), [{ text: 'Data' }])
    assert.deepEqual(parseCredit('<a>No href</a>'), [{ text: 'No href' }])
    assert.deepEqual(parseCredit('<a href=http://example.org>Unquoted</a>'), [{ text: 'Unquoted', href: 'http://example.org' }])
  })

  test('other markup comes out as plain text', () => {
    assert.deepEqual(parseCredit('<img src=x onerror="alert(1)">Tiles <b>bold</b><script>alert(1)</script>'), [
      { text: 'Tiles boldalert(1)' },
    ])
    assert.deepEqual(parseCredit('<a href="https://ok.example"><img src=x onerror=alert(1)>Name</a>'), [
      { text: 'Name', href: 'https://ok.example' },
    ])
  })

  test('an empty credit has no parts', () => {
    assert.deepEqual(parseCredit(''), [])
    assert.deepEqual(parseCredit('<span> </span>'), [])
  })
})
