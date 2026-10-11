import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AUTO_STYLE, mapStylesFor, resolveStyle } from './mapStyles.ts'

const liberty = 'https://tiles.openfreemap.org/styles/liberty'

describe('mapStylesFor', () => {
  test('OpenFreeMap offers its styles, the configured one as default', () => {
    const { styles, defaultStyle } = mapStylesFor(liberty)
    assert.deepEqual(
      styles.map((style) => style.id),
      ['standard', 'light', 'bright', 'dark', 'dark-blue'],
    )
    assert.equal(defaultStyle, 'standard')
    assert.equal(mapStylesFor('https://tiles.openfreemap.org/styles/positron').defaultStyle, 'light')
  })

  test('a self-hosted style is the only one', () => {
    const own = 'https://maps.example.com/style.json'
    assert.deepEqual(mapStylesFor(own), { styles: [{ id: 'custom', name: 'Map', url: own, dark: false }], defaultStyle: 'custom' })
  })

  test('the night maps are dark', () => {
    const dark = mapStylesFor(liberty)
      .styles.filter((style) => style.dark)
      .map((style) => style.id)
    assert.deepEqual(dark, ['dark', 'dark-blue'])
  })
})

describe('resolveStyle', () => {
  const { styles, defaultStyle } = mapStylesFor(liberty)
  const pick = (choice: string, dark = false) => resolveStyle(styles, choice, defaultStyle, dark).id

  test('a chosen style', () => {
    assert.equal(pick('bright'), 'bright')
  })

  test('Auto follows light and dark mode', () => {
    assert.equal(pick(AUTO_STYLE, false), 'standard')
    assert.equal(pick(AUTO_STYLE, true), 'dark')
  })

  test('an unknown choice falls back to the default', () => {
    assert.equal(pick('satellite'), 'standard')
  })

  test('with only a self-hosted style, every choice is that style', () => {
    const own = mapStylesFor('https://maps.example.com/style.json')
    assert.equal(resolveStyle(own.styles, AUTO_STYLE, own.defaultStyle, true).id, 'custom')
  })
})
