import type { Marker } from 'maplibre-gl'
import { assetInitial, type Asset } from '../../lib/asset'
import { distance } from '../../lib/segments'
import { PIN_PATH } from './placeLayers'

// The assets' markers: maplibre DOM markers (enough for ≤5), a dot with the asset's picture or
// initial and a name label, styled in styles.css (.marker). Greyed out when stale, ringed when
// selected, and wearing a place's pin as a badge when the asset is at a place too small on screen to
// show its own (see showsPin in placeLayers.ts). Two or more at one place are its pin with a count
// further out (createPlaceCount), and close in sit in a row in a pill under it, each tappable (createCapsule).

/** A marker moving farther than this goes there at once: a jump, not a glide across the map. */
const GLIDE_MAX_METERS = 150
/**
 * Assets at the same place, close in (see PILL_ZOOM in AssetMap.tsx), sit in a pill centred under
 * its pin (see createCapsule): each asset's marker in a slot this wide (px), the bigger picture kind
 * with its ring included. Further out they're the place's pin with a count (createPlaceCount).
 */
export const CAPSULE_SLOT = 48
/** From the place's pin, at the spot, to the top of the pill (px): half the pin, and a gap. */
export const CAPSULE_TOP = 18
const CAPSULE_HEIGHT = 52

/** Where a marker sits among its place's assets: `index` from the left of `count`; `close`, in the pill, else hidden behind the count. */
export type InCapsule = { index: number; count: number; close: boolean }

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

/**
 * The pill for assets at one place, close in: room for their markers, which sit over it (see
 * CAPSULE_SLOT), centred under the place's pin. Decorative: each marker says where its asset is.
 */
export function createCapsule(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'place-capsule'
  element.setAttribute('aria-hidden', 'true')
  return element
}

export function updateCapsule(element: HTMLElement, count: number) {
  element.style.width = `${count * CAPSULE_SLOT + 8}px`
}

/** Further out: the place's pin with how many assets are at it; tapping it zooms in to the pill. */
export function createPlaceCount(onTap: () => void): HTMLElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'place-count'
  element.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PIN_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>` +
    '<span class="place-count-badge" aria-hidden="true"></span>'
  element.addEventListener('click', (event) => {
    event.stopPropagation()
    onTap()
  })
  return element
}

export function updatePlaceCount(element: HTMLElement, names: string[], placeName: string) {
  element.querySelector('.place-count-badge')!.textContent = String(names.length)
  const listed = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  element.setAttribute('aria-label', `${listed} at ${placeName}: zoom in`)
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
  state: { stale: boolean; selected: boolean; atPlace?: string; capsule?: InCapsule },
) {
  const inCapsule = state.capsule !== undefined
  element.classList.toggle('marker-stale', state.stale)
  element.classList.toggle('marker-selected', state.selected)
  // In a capsule, the capsule shows the place, and the card the name.
  element.classList.toggle('marker-in-capsule', inCapsule)
  element.setAttribute('aria-label', state.atPlace ? `Show ${asset.name}, at ${state.atPlace}` : `Show ${asset.name}`)
  element.querySelector<HTMLElement>('.marker-badge')!.hidden = !state.atPlace || inCapsule
  element.querySelector('.marker-initial')!.textContent = assetInitial(asset.name)
  element.querySelector('.marker-label')!.textContent = asset.name
  const { index = 0, count = 1, close = true } = state.capsule ?? {}
  element.classList.toggle('marker-hidden', inCapsule && !close)
  const [x, y] = inCapsule ? [(index - (count - 1) / 2) * CAPSULE_SLOT, CAPSULE_TOP + CAPSULE_HEIGHT / 2] : [0, 0]
  element.style.translate = x || y ? `${x}px ${y}px` : ''
  element.style.zIndex = inCapsule ? '10' : ''

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
