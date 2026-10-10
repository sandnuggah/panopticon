import { Marker, type GeoJSONSource, type MapLibreMap } from 'maplibre-gl'
import type { Place } from '../../lib/places'
import { circle } from './geometry'

// Places (lib/places.ts) on the map: a soft area with an outline in --place, under the trail, and
// the name at its top edge, where it doesn't cover an asset at home. Names are DOM labels like the
// markers' (styles.css .place-label): the map's own text needs fonts the style may not have.

const PLACES = 'places'
const PLACES_FILL = 'places-fill'
const PLACES_OUTLINE = 'places-outline'

/** Each map's name labels, by place id. */
const labelsByMap = new WeakMap<MapLibreMap, Map<number, Marker>>()
/** A label shows once its place is at least this big on screen (px across); smaller, it would sit on the markers. */
const LABEL_MIN_PX = 24

/** Adds the place layers, empty; again after each style load, before the trail's so they sit under it. */
export function addPlaceLayers(map: MapLibreMap) {
  const color = placeColor()
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
  if (!labels) {
    labelsByMap.set(map, (labels = new Map()))
    map.on('zoom', () => showLabelsBySize(map))
  }
  for (const [id, label] of labels) {
    if (shown.some((place) => place.id === id)) continue
    label.remove()
    labels.delete(id)
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
  }
  showLabelsBySize(map)
}

/** Hides the labels of places too small on screen at this zoom. */
function showLabelsBySize(map: MapLibreMap) {
  const metresPerPixel = (40_075_016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
  for (const label of labelsByMap.get(map)?.values() ?? []) {
    const element = label.getElement()
    element.hidden = Number(element.dataset.size) / metresPerPixel < LABEL_MIN_PX
  }
}

/** About how big a place is, in metres across. */
function size(place: Place): number {
  const { area } = place
  if (area.kind === 'circle') return area.radius * 2
  const lats = area.ring.map((point) => point.lat)
  return (Math.max(...lats) - Math.min(...lats)) * 111_320
}

/** Repaints the places in the current --place colour, after light or dark mode changes. */
export function recolourPlaces(map: MapLibreMap) {
  const color = placeColor()
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

/** The --place colour for the current light or dark mode; the map's paint properties can't read CSS variables. */
export function placeColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--place').trim() || '#5856d6'
}
