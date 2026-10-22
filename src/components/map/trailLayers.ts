import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl'
import type { LatLon } from '../../lib/segments'
import { toTrailFeatures, type TrailViews } from '../../lib/trailGeometry'

// The trail on the map, drawn by what the asset was doing (see segments.ts, and trailGeometry.ts for
// what's drawn where): walking as a line, or as paw prints (Appearance → Paw prints); rides through
// their fixes, dashed, and dotted where they went without GPS (underground); stays as dots, bigger the
// longer they were. Markers are DOM elements, so they always sit above all of it.

const TRAILS = 'trails'
const RIDES_VEHICLE = 'trail-vehicle'
const RIDES_UNDERGROUND = 'trail-underground'
const STAYS = 'trail-stays'
const PAWS = 'paws'
const PAW_IMAGE = 'paw-prints'

/** Shows these trails (see useLiveAssets), snapping walks to paths where Snap to paths has them (see useSnappedWalks). */
export function setTrails(map: MapLibreMap, trails: TrailViews, snappedWalks: Record<string, LatLon[]>) {
  const features = toTrailFeatures(trails, snappedWalks)
  void map.getSource<GeoJSONSource>(TRAILS)?.setData(features.trail)
  void map.getSource<GeoJSONSource>(PAWS)?.setData(features.paws)
}

/** Walks as paw prints, or as a line. */
export function showPawPrints(map: MapLibreMap, on: boolean) {
  map.setLayoutProperty(TRAILS, 'visibility', on ? 'none' : 'visible')
  map.setLayoutProperty(PAWS, 'visibility', on ? 'visible' : 'none')
}

/** Repaints the trail in the current --trail colour, after switching between a day and a night map. */
export function recolourTrails(map: MapLibreMap) {
  const color = trailColor(map)
  for (const layer of [TRAILS, RIDES_VEHICLE, RIDES_UNDERGROUND]) map.setPaintProperty(layer, 'line-color', color)
  map.setPaintProperty(STAYS, 'circle-color', color)
  map.updateImage(PAW_IMAGE, drawPawPrints(color))
}

/** Adds the trail layers, empty; again after each style load, since a new style drops them. */
export function addTrailLayers(map: MapLibreMap) {
  const color = trailColor(map)
  const empty = toTrailFeatures({}, {})
  const kind = (value: string) => ['==', ['get', 'kind'], value] as ['==', ['get', string], string]
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const
  map.addSource(TRAILS, { type: 'geojson', data: empty.trail })
  map.addLayer({
    id: TRAILS,
    type: 'line',
    source: TRAILS,
    filter: kind('move'),
    layout: lineLayout,
    paint: {
      'line-color': color,
      'line-width': 4,
      'line-opacity': ['get', 'opacity'],
    },
  })
  map.addLayer({
    id: RIDES_VEHICLE,
    type: 'line',
    source: TRAILS,
    filter: kind('vehicle'),
    layout: lineLayout,
    paint: {
      'line-color': color,
      'line-width': 3,
      'line-opacity': ['get', 'opacity'],
      'line-dasharray': [2, 1.6],
    },
  })
  map.addLayer({
    id: RIDES_UNDERGROUND,
    type: 'line',
    source: TRAILS,
    filter: kind('underground'),
    layout: lineLayout,
    // Zero-length dashes with round caps: a dotted line.
    paint: {
      'line-color': color,
      'line-width': 5,
      'line-opacity': ['get', 'opacity'],
      'line-dasharray': [0, 1.8],
    },
  })
  // Stays on top of the lines that run through them: a dot with a white ring, 5 px across a short
  // stop up to 9 px for an hour or more. White, like a location dot's, since the map can be light or
  // dark whatever the device's mode (Settings → Map style).
  map.addLayer({
    id: STAYS,
    type: 'circle',
    source: TRAILS,
    filter: kind('stay'),
    paint: {
      'circle-color': color,
      'circle-radius': ['interpolate', ['linear'], ['get', 'minutes'], 2, 5, 60, 9],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-opacity': ['get', 'opacity'],
    },
  })

  // Walking as paw prints instead of the line: shown in place of TRAILS when the setting is on.
  map.addImage(PAW_IMAGE, drawPawPrints(color), {
    pixelRatio: PAW_PIXEL_RATIO,
  })
  map.addSource(PAWS, { type: 'geojson', data: empty.paws })
  map.addLayer({
    id: PAWS,
    type: 'symbol',
    source: PAWS,
    layout: {
      visibility: 'none',
      // maplibre spaces the prints along each line and turns them to follow it: the icon's +x axis
      // points the way the line runs, oldest to newest, i.e. the direction of travel.
      'symbol-placement': 'line',
      'symbol-spacing': 44,
      'icon-image': PAW_IMAGE,
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['get', 'opacity'] },
  })
}

const PAW_PIXEL_RATIO = 2

/**
 * A left and a right paw print, staggered like a trotting dog, both pointing along +x. Drawn at
 * 2x for sharp edges. Drawn in code, so there's no image file to load.
 */
function drawPawPrints(color: string): ImageData {
  const width = 56
  const height = 36
  const canvas = document.createElement('canvas')
  canvas.width = width * PAW_PIXEL_RATIO
  canvas.height = height * PAW_PIXEL_RATIO
  const context = canvas.getContext('2d')!
  context.scale(PAW_PIXEL_RATIO, PAW_PIXEL_RATIO)
  context.fillStyle = color
  const paw = (x: number, y: number, size: number) => {
    const ellipse = (dx: number, dy: number, rx: number, ry: number) => {
      context.beginPath()
      context.ellipse(x + dx * size, y + dy * size, rx * size, ry * size, 0, 0, Math.PI * 2)
      context.fill()
    }
    ellipse(-2, 0, 4.2, 5) // main pad
    ellipse(2.8, -5.4, 1.8, 1.6) // toes, fanned out ahead of it
    ellipse(5, -1.9, 1.9, 1.7)
    ellipse(5, 1.9, 1.9, 1.7)
    ellipse(2.8, 5.4, 1.8, 1.6)
  }
  paw(12, 11, 1.25)
  paw(40, 25, 1.25)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/** The --trail colour for this map, a day or night map (AssetMap's .map-light, .map-dark); paint properties can't read CSS variables. */
function trailColor(map: MapLibreMap): string {
  return getComputedStyle(map.getContainer()).getPropertyValue('--trail').trim() || '#2f8f5b'
}
