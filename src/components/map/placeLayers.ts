import { Marker, type GeoJSONSource, type MapLibreMap } from 'maplibre-gl'
import { placeCenter, type Place } from '../../lib/places'
import { circle } from './geometry'

// Places (lib/places.ts) on the map: a soft area with an outline in --place, under the trail, a pin
// at its centre, and the name at its top edge, where it doesn't cover an asset at home. The pin and
// name are DOM markers like the assets' (styles.css .place-pin, .place-label), under them: the map's
// own symbols need fonts and icons the style may not have.

const PLACES = 'places'
const PLACES_FILL = 'places-fill'
const PLACES_OUTLINE = 'places-outline'

/** Each map's name labels and centre pins, by place id. */
const labelsByMap = new WeakMap<MapLibreMap, Map<number, Marker>>()
const pinsByMap = new WeakMap<MapLibreMap, Map<number, Marker>>()
/** The pin's map pin glyph, as PinIcon in icons.tsx; also the badge on an asset at a place (markers.ts). */
export const PIN_PATH =
  'M12 21.5s-6.5-6.2-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11.5-6.5 11.5ZM12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z'
/** A label and pin show once their place is at least this big on screen (px across); smaller, they would sit on the markers. */
const LABEL_MIN_PX = 24

/** Adds the place layers, empty; again after each style load, before the trail's so they sit under it. */
export function addPlaceLayers(map: MapLibreMap) {
  const color = placeColor(map)
  map.addSource(PLACES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({ id: PLACES_FILL, type: 'fill', source: PLACES, paint: { 'fill-color': color, 'fill-opacity': 0.1 } })
  map.addLayer({
    id: PLACES_OUTLINE,
    type: 'line',
    source: PLACES,
    paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 1.5] },
  })
}

/** Shows these places, except `hiddenId` (the one being edited, which the editor draws itself). */
export function setPlaces(map: MapLibreMap, places: Place[], hiddenId: number | undefined) {
  const shown = places.filter((place) => place.id !== hiddenId)
  void map.getSource<GeoJSONSource>(PLACES)?.setData({
    type: 'FeatureCollection',
    features: shown.map((place) => ({
      type: 'Feature',
      properties: { id: place.id },
      geometry: { type: 'Polygon', coordinates: [outline(place)] },
    })),
  })

  let labels = labelsByMap.get(map)
  let pins = pinsByMap.get(map)
  if (!labels || !pins) {
    labelsByMap.set(map, (labels = new Map()))
    pinsByMap.set(map, (pins = new Map()))
    map.on('zoom', () => showLabelsBySize(map))
  }
  for (const markers of [labels, pins]) {
    for (const [id, marker] of markers) {
      if (shown.some((place) => place.id === id)) continue
      marker.remove()
      markers.delete(id)
    }
  }
  for (const place of shown) {
    let label = labels.get(place.id)
    if (!label) {
      const element = document.createElement('div')
      element.className = 'place-label'
      label = new Marker({ element, anchor: 'bottom' }).setLngLat(top(place)).addTo(map)
      labels.set(place.id, label)
    }
    label.setLngLat(top(place))
    label.getElement().textContent = place.name
    label.getElement().dataset.size = String(size(place))

    let pin = pins.get(place.id)
    if (!pin) {
      pin = new Marker({ element: pinElement() }).setLngLat(centre(place)).addTo(map)
      pins.set(place.id, pin)
    }
    pin.setLngLat(centre(place))
    pin.getElement().dataset.size = String(size(place))
  }
  showLabelsBySize(map)
}

/** Places with a capsule of assets on their pin (markers.ts), which names the place: their own label steps aside. */
export function setCapsulePlaces(map: MapLibreMap, placeIds: ReadonlySet<number>) {
  for (const [id, label] of labelsByMap.get(map) ?? []) label.getElement().classList.toggle('place-label-capsuled', placeIds.has(id))
}

/** A place's pin: the map pin glyph on a disc in the place's colour, decorative (the name says what it is). */
function pinElement(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'place-pin'
  element.setAttribute('aria-hidden', 'true')
  element.innerHTML = `<svg viewBox="0 0 24 24"><path d="${PIN_PATH}" fill="currentColor" fill-rule="evenodd"/></svg>`
  return element
}

/** Hides the labels and pins of places too small on screen at this zoom. */
function showLabelsBySize(map: MapLibreMap) {
  for (const marker of [...(labelsByMap.get(map)?.values() ?? []), ...(pinsByMap.get(map)?.values() ?? [])]) {
    const element = marker.getElement()
    element.hidden = tooSmall(map, Number(element.dataset.size))
  }
}

/**
 * Whether a place shows its pin at this zoom. When it doesn't, an asset at it wears the pin as a
 * badge instead (markers.ts).
 */
export function showsPin(map: MapLibreMap, place: Place): boolean {
  return !tooSmall(map, size(place))
}

function tooSmall(map: MapLibreMap, metresAcross: number): boolean {
  const metresPerPixel = (40_075_016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
  return metresAcross / metresPerPixel < LABEL_MIN_PX
}

/** The place's centre: a circle's, or the middle of a polygon's bounds. */
function centre(place: Place): [number, number] {
  const { lat, lon } = placeCenter(place.area)
  return [lon, lat]
}

/** About how big a place is, in metres across. */
function size(place: Place): number {
  const { area } = place
  if (area.kind === 'circle') return area.radius * 2
  const lats = area.ring.map((point) => point.lat)
  return (Math.max(...lats) - Math.min(...lats)) * 111_320
}

/** Repaints the places in the current --place colour, after switching between a day and a night map. */
export function recolourPlaces(map: MapLibreMap) {
  const color = placeColor(map)
  map.setPaintProperty(PLACES_FILL, 'fill-color', color)
  map.setPaintProperty(PLACES_OUTLINE, 'line-color', color)
}

function outline(place: Place): [number, number][] {
  const { area } = place
  if (area.kind === 'circle') return circle(area.center, area.radius)
  const ring = area.ring.map((point): [number, number] => [point.lon, point.lat])
  const [first, last] = [ring[0]!, ring.at(-1)!]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

/** The top edge's middle: north of a circle's centre, or a polygon's northernmost corner. */
function top(place: Place): [number, number] {
  const { area } = place
  if (area.kind === 'circle') return [area.center.lon, area.center.lat + area.radius / 111_320]
  const north = area.ring.reduce((best, point) => (point.lat > best.lat ? point : best))
  return [north.lon, north.lat]
}

/** The --place colour for this map, a day or night map (AssetMap's .map-light, .map-dark); paint properties can't read CSS variables. */
export function placeColor(map: MapLibreMap): string {
  return getComputedStyle(map.getContainer()).getPropertyValue('--place').trim() || '#5856d6'
}
