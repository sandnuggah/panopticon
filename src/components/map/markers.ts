import { assetInitial, type Asset } from '../../lib/asset'
import { PIN_PATH } from './placeLayers'

// The assets' markers: maplibre DOM markers (enough for ≤5), a dot with the asset's picture or
// initial and a name label, styled in styles.css (.marker). Greyed out when stale, ringed when
// selected, and wearing a place's pin as a badge when the asset is at a place too small on screen to
// show its own (see showsPin in placeLayers.ts).

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
