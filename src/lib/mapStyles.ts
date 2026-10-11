// The map styles to choose between. With OpenFreeMap (the default MAP_STYLE_URL) that's its five
// free styles, plus Auto, which follows the device's light or dark mode. A self-hosted style has
// nothing to choose between, so there's no choice to offer. No runtime imports: Node runs the tests.

/** `dark`: a night map, so what's drawn on it (trail, places, markers) takes its dark colours. */
export type MapStyle = { id: string; name: string; url: string; dark: boolean }

/** Standard by day, Dark by night: the device's light or dark mode. */
export const AUTO_STYLE = 'auto'

const OPENFREEMAP = 'https://tiles.openfreemap.org'

const OPENFREEMAP_STYLES: [id: string, name: string, path: string, dark: boolean][] = [
  ['standard', 'Standard', 'liberty', false],
  ['light', 'Light', 'positron', false],
  ['bright', 'Bright', 'bright', false],
  ['dark', 'Dark', 'dark', true],
  ['dark-blue', 'Dark blue', 'fiord', true],
]

/**
 * The styles offered for MAP_STYLE_URL, and which one is the default: OpenFreeMap's styles, with
 * the configured one as the default, or just the configured style when it's anything else (taken
 * to be a day map: there's no telling).
 */
export function mapStylesFor(styleUrl: string): { styles: MapStyle[]; defaultStyle: string } {
  if (new URL(styleUrl).origin !== OPENFREEMAP)
    return { styles: [{ id: 'custom', name: 'Map', url: styleUrl, dark: false }], defaultStyle: 'custom' }
  const styles = OPENFREEMAP_STYLES.map(([id, name, path, dark]) => ({ id, name, url: `${OPENFREEMAP}/styles/${path}`, dark }))
  const configured = styles.find((style) => style.url === styleUrl.replace(/\/$/, ''))
  return { styles, defaultStyle: configured?.id ?? 'standard' }
}

/** The style to draw for a choice (a style's id, or Auto); unknown choices fall back to the default. */
export function resolveStyle(styles: MapStyle[], choice: string, defaultStyle: string, prefersDark: boolean): MapStyle {
  const find = (id: string) => styles.find((style) => style.id === id)
  if (choice === AUTO_STYLE) return (prefersDark ? find('dark') : find(defaultStyle)) ?? styles[0]!
  return find(choice) ?? find(defaultStyle) ?? styles[0]!
}
