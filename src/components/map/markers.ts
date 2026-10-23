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
export function updateMarkerElement(element: HTMLElement, asset: Asset, state: { stale: boolean; selected: boolean; atPlace?: string }) {
  element.classList.toggle('marker-stale', state.stale)
  element.classList.toggle('marker-selected', state.selected)
  element.setAttribute('aria-label', state.atPlace ? `Show ${asset.name}, at ${state.atPlace}` : `Show ${asset.name}`)
  element.querySelector<HTMLElement>('.marker-badge')!.hidden = !state.atPlace
  element.querySelector('.marker-initial')!.textContent = assetInitial(asset.name)
  element.querySelector('.marker-label')!.textContent = asset.name

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
