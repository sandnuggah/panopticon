import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl'
import type { MyPosition } from '../../lib/useMyPosition'

// Drawing your own position on the map (see useMyPosition): a blue dot with a soft circle for how
// accurate it is, and the icon for the map button that turns it on and off. Class names avoid
// words content blockers hide (see the Share menu in styles.css).

const ACCURACY = 'my-position-accuracy'
const BLUE = '#2f7bf6'

/** The navigation arrow on the "Show my position" button, like the phone's own maps. */
export const MY_POSITION_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 2 2.5 7.1l5.2 1.2L8.9 13.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'

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
