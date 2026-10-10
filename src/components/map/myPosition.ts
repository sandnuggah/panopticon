import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl'
import type { MyPosition } from '../../lib/useMyPosition'

// Drawing your own position on the map (see useMyPosition): a blue dot with a soft circle for how
// accurate it is. Class names avoid words content blockers hide (see styles.css).

const ACCURACY = 'my-position-accuracy'
const BLUE = '#2f7bf6'

/** The accuracy circle's source and layer, added with the map's other layers. */
export function addMyPositionLayer(map: MapLibreMap): void {
  map.addSource(ACCURACY, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: ACCURACY,
    type: 'fill',
    source: ACCURACY,
    paint: { 'fill-color': BLUE, 'fill-opacity': 0.12, 'fill-outline-color': BLUE },
  })
}

/** Draws the accuracy circle for `position`, or clears it. */
export function setAccuracyCircle(map: MapLibreMap, position: MyPosition | null, ring: [number, number][]): void {
  void map.getSource<GeoJSONSource>(ACCURACY)?.setData({
    type: 'FeatureCollection',
    features: position ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] : [],
  })
}

export function createMyPositionDot(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'my-position-dot'
  element.setAttribute('aria-label', 'Your position')
  element.setAttribute('role', 'img')
  return element
}
