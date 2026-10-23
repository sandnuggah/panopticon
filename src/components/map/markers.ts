import type { Marker } from 'maplibre-gl'
import { assetInitial, type Asset } from '../../lib/asset'
import { distance } from '../../lib/segments'
import { PIN_PATH } from './placeLayers'

// The assets' markers: maplibre DOM markers (enough for ≤5), a dot with the asset's picture or
// initial and a name label, styled in styles.css (.marker). Greyed out when stale, ringed when
// selected, and wearing a place's pin as a badge when the asset is at a place too small on screen to
// show its own (see showsPin in placeLayers.ts).

/** A marker moving farther than this goes there at once: a jump, not a glide across the map. */
const GLIDE_MAX_METERS = 150
/**
 * In a stack, how far (px) each marker behind the top one peeks out to the right, and a little up:
 * enough to show past the top one's selection ring, even when it's the bigger, picture kind.
 */
const STACK_STEP = { x: 18, y: -6 }
/** Fanned out, how far apart (px) the markers stand in their row. */
const FAN_STEP = 64
/** A stack's label names as many of its assets as fit in this width (px), and "+2" for the rest. */
const STACK_LABEL_PX = 140

/**
 * Where a marker sits among others at the same spot (assets at one place share its pin, see
 * shownLocation in presence.ts): `index` 0 on top. Stacked, the others peek out behind it and its
 * label names them all, as many as fit (`names`, top first); fanned out, they stand in a row, each
 * with its own name, to be tapped.
 */
export type Stack = { index: number; size: number; fanned: boolean; names: string[] }

/** How the camera eases (maplibre's own default), so a followed marker and the map move as one. */
export function ease(t: number): number {
  // cubic-bezier(0.25, 0.1, 0.25, 1), solved for x by bisection.
  const bezier = (p1: number, p2: number, u: number) => 3 * p1 * u * (1 - u) ** 2 + 3 * p2 * u ** 2 * (1 - u) + u ** 3
  let [low, high] = [0, 1]
  for (let k = 0; k < 20; k++) {
    const middle = (low + high) / 2
    if (bezier(0.25, 0.25, middle) < t) low = middle
    else high = middle
  }
  return bezier(0.1, 1, (low + high) / 2)
}

/** Each gliding marker's frame and where it's going. */
const glides = new WeakMap<Marker, { frame: number; to: [number, number] }>()

/**
 * Moves a marker to a new position over `ms`, with the camera's easing (see ease), so a followed
 * asset doesn't jump ahead of the map gliding after it; at once when it's far (GLIDE_MAX_METERS) or
 * with Reduce Motion on.
 */
export function glideMarker(marker: Marker, to: [number, number], ms: number) {
  const going = glides.get(marker)
  if (going && going.to[0] === to[0] && going.to[1] === to[1]) return
  if (going) cancelAnimationFrame(going.frame)
  glides.delete(marker)
  const from = marker.getLngLat()
  if (from.lng === to[0] && from.lat === to[1]) return
  const far = distance({ lat: from.lat, lon: from.lng }, { lat: to[1], lon: to[0] }) > GLIDE_MAX_METERS
  if (far || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    marker.setLngLat(to)
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const e = ease(t)
    marker.setLngLat([from.lng + (to[0] - from.lng) * e, from.lat + (to[1] - from.lat) * e])
    if (t < 1) glides.set(marker, { frame: requestAnimationFrame(step), to })
    else glides.delete(marker)
  }
  glides.set(marker, { frame: requestAnimationFrame(step), to })
}

/** "Betty, Sixten", or "Betty, Sixten +2" when the rest wouldn't fit in STACK_LABEL_PX, at least the first name. */
function stackLabel(names: string[], label: HTMLElement): string {
  const width = textWidth(label)
  for (let shown = names.length; shown > 1; shown--) {
    const text = names.slice(0, shown).join(', ') + (shown < names.length ? ` +${names.length - shown}` : '')
    if (width(text) <= STACK_LABEL_PX) return text
  }
  return `${names[0]} +${names.length - 1}`
}

/** "Betty and Sixten", "Betty, Sixten and Bamse". */
function listed(names: string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

let measure: CanvasRenderingContext2D | null = null

/** How wide text is in an element's font, in px. */
function textWidth(element: HTMLElement): (text: string) => number {
  measure ??= document.createElement('canvas').getContext('2d')
  const style = getComputedStyle(element)
  if (measure) measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return (text) => measure?.measureText(text).width ?? text.length * 7
}

/** A marker's element; tapping it calls `onTapRef.current` with the asset's id. */
export function createMarkerElement(assetId: number, onTapRef: { current: (id: number) => void }): HTMLElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'marker'
  element.innerHTML =
    '<span class="marker-dot"><span class="marker-initial"></span><img class="marker-image" alt="" hidden></span>' +
    '<span class="marker-label"></span>' +
    `<span class="marker-badge" hidden><svg viewBox="0 0 24 24"><path d="${PIN_PATH}" fill="currentColor" fill-rule="evenodd"/></svg></span>`
  const image = element.querySelector<HTMLImageElement>('.marker-image')!
  image.decoding = 'async'
  image.draggable = false
  // No picture after all (deleted, or Traccar unreachable): the initial underneath shows through.
  image.addEventListener('error', () => {
    image.hidden = true
    image.dataset.failed = 'true'
    element.classList.remove('marker-has-image')
  })
  element.addEventListener('click', (event) => {
    event.stopPropagation()
    onTapRef.current(assetId)
  })
  return element
}

/**
 * Brings a marker up to date with its asset: name, picture, stale and selected, and `atPlace`, the
 * name of the place it's at when that place's own pin isn't showing.
 */
export function updateMarkerElement(
  element: HTMLElement,
  asset: Asset,
  state: { stale: boolean; selected: boolean; atPlace?: string; stack?: Stack },
) {
  const { index = 0, size = 1, fanned = false, names = [] } = state.stack ?? {}
  const stacked = size > 1 && !fanned
  const top = stacked && index === 0
  element.classList.toggle('marker-stale', state.stale)
  element.classList.toggle('marker-selected', state.selected)
  element.classList.toggle('marker-behind', stacked && index > 0)
  const where = state.atPlace ? `, at ${state.atPlace}` : ''
  element.setAttribute('aria-label', top ? `${listed(names)}${where}: show them all` : `Show ${asset.name}${where}`)
  element.setAttribute('aria-expanded', String(size > 1 ? fanned : false))
  if (size < 2) element.removeAttribute('aria-expanded')
  element.querySelector<HTMLElement>('.marker-badge')!.hidden = !state.atPlace
  element.querySelector('.marker-initial')!.textContent = assetInitial(asset.name)
  const label = element.querySelector<HTMLElement>('.marker-label')!
  label.textContent = top ? stackLabel(names, label) : asset.name
  // Stacked: to the right behind the top one; fanned out: in a row centred on the spot.
  const [x, y] = size < 2 ? [0, 0] : fanned ? [(index - (size - 1) / 2) * FAN_STEP, 0] : [index * STACK_STEP.x, index * STACK_STEP.y]
  element.style.translate = x || y ? `${x}px ${y}px` : ''
  element.style.zIndex = size < 2 ? '' : String(10 + size - index)

  const image = element.querySelector<HTMLImageElement>('.marker-image')!
  if (image.dataset.src !== asset.imageUrl) {
    // Only touch the <img> when the picture changes, so live updates don't reload it.
    delete image.dataset.failed
    if (asset.imageUrl) {
      image.dataset.src = asset.imageUrl
      image.src = asset.imageUrl
    } else {
      delete image.dataset.src
      image.removeAttribute('src')
    }
  }
  const showImage = Boolean(asset.imageUrl) && !image.dataset.failed
  image.hidden = !showImage
  element.classList.toggle('marker-has-image', showImage)
}
