import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, MapLibreMap } from 'maplibre-gl'
import type { SnappedLines } from '../../lib/snapLines'
import { toTrailFeatures, type TrailViews } from '../../lib/trailGeometry'
import { DEFAULT_TRAIL_COLOR, TRAIL_COLORS, trailColorOf } from '../../lib/trailColors'

// The trail on the map, drawn by what the asset was doing (see segments.ts, and trailGeometry.ts for
// what's drawn where): walking as a line, or as paw prints close up (Appearance → Paw prints); rides
// through their fixes, dashed, and dotted where they went without GPS (underground); stays as dots,
// bigger the longer they were. The latest outing in front, with a casing; older ones behind it as one
// layer; walks along the same street side by side, like a metro map's lines (lanes.ts), so the
// street home, walked every day, shows each walk; ways nobody saw thinner and lighter. All of it
// under the map's labels. Markers are DOM elements, so they always sit above.

const TRAILS = 'trails'
const OLDER = 'trails-older'
const CASING = 'trails-casing'
const RIDES_VEHICLE = 'trail-vehicle'
const RIDES_UNDERGROUND = 'trail-underground'
const STAYS = 'trail-stays'
const PAWS = 'paws'
const PAW_IMAGE = 'paw-prints'
/** Paw prints from this zoom, where they're far enough apart to read; the line below it. */
const PAW_ZOOM = 16.5
/** Older outings, as one layer: faint enough to stay behind the latest, clear enough to see on a park. */
const OLDER_OPACITY = 0.4
/** Between walks side by side along a street (see lanes.ts), pixels. */
const LANE_GAP = 1.5
/** A guess (see trailGeometry.ts) at this much of the line's opacity. */
const GUESS_OPACITY = 0.6

/**
 * Shows these trails (see useLiveAssets), along the lines Snap to paths has for their walks (see
 * useSnappedWalks), each in its asset's colour (`colors`, by asset id; see trailColors.ts).
 */
export function setTrails(map: MapLibreMap, trails: TrailViews, snappedWalks: SnappedLines, colors: Record<number, string>) {
  const features = toTrailFeatures(trails, snappedWalks, colors)
  void map.getSource<GeoJSONSource>(TRAILS)?.setData(features.trail)
  void map.getSource<GeoJSONSource>(PAWS)?.setData(features.paws)
}

/** The latest outing's walks as paw prints close up (from PAW_ZOOM), or as a line. */
export function showPawPrints(map: MapLibreMap, on: boolean) {
  for (const layer of [TRAILS, CASING]) map.setLayerZoomRange(layer, 0, on ? PAW_ZOOM : 24)
  map.setLayoutProperty(PAWS, 'visibility', on ? 'visible' : 'none')
}

/** Repaints the trails in their colours' shades for a day or a night map, after switching between them. */
export function recolourTrails(map: MapLibreMap) {
  const color = trailColors(map)
  for (const layer of [TRAILS, OLDER, RIDES_VEHICLE, RIDES_UNDERGROUND]) map.setPaintProperty(layer, 'line-color', color)
  map.setPaintProperty(CASING, 'line-color', casingColor(map))
  map.setPaintProperty(STAYS, 'circle-color', color)
  for (const option of TRAIL_COLORS) map.updateImage(pawImage(option.id), drawPawPrints(trailColorOf(option.id, isDark(map))))
}

/** Adds the trail layers, empty; again after each style load, since a new style drops them. */
export function addTrailLayers(map: MapLibreMap) {
  const color = trailColors(map)
  const empty = toTrailFeatures({}, {})
  const kind = (value: string) => ['==', ['get', 'kind'], value] as ['==', ['get', string], string]
  const older: ExpressionSpecification = ['==', ['get', 'older'], true]
  const guess: ExpressionSpecification = ['==', ['get', 'guess'], true]
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const
  // Under the map's labels (street names, places), with all its layers in this order.
  const labels = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id
  const addLayer = (layer: LayerSpecification) => map.addLayer(layer, labels)
  // About 2.5 px across at zoom 12 to 5.5 px at 18, a guess about half that; a casing 1.5 px each side.
  const width = (extra: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    ['case', guess, 1.5 + extra, 2.5 + extra],
    18,
    ['case', guess, 3 + extra, 5.5 + extra],
  ]
  // Walks along the same street side by side (see lanes.ts): a lane is a line's width and LANE_GAP apart.
  const lane: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    ['*', ['coalesce', ['get', 'lane'], 0], 2.5 + LANE_GAP],
    18,
    ['*', ['coalesce', ['get', 'lane'], 0], 5.5 + LANE_GAP],
  ]
  map.addSource(TRAILS, { type: 'geojson', data: empty.trail })
  addLayer({
    id: OLDER,
    type: 'line',
    source: TRAILS,
    filter: ['all', kind('move'), older],
    layout: lineLayout,
    paint: {
      'line-offset': lane,
      'line-color': color,
      'line-width': width(0),
      'line-opacity': ['case', guess, GUESS_OPACITY, 1],
      'line-layer-opacity': OLDER_OPACITY,
    },
  })
  addLayer({
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
  addLayer({
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
  addLayer({
    id: CASING,
    type: 'line',
    source: TRAILS,
    filter: ['all', kind('move'), ['!', older], ['!', guess]],
    layout: lineLayout,
    paint: {
      'line-offset': lane,
      'line-color': casingColor(map),
      'line-width': width(3),
      'line-opacity': ['get', 'opacity'],
    },
  })
  addLayer({
    id: TRAILS,
    type: 'line',
    source: TRAILS,
    filter: ['all', kind('move'), ['!', older]],
    layout: lineLayout,
    paint: {
      'line-offset': lane,
      'line-color': color,
      'line-width': width(0),
      'line-opacity': ['*', ['get', 'opacity'], ['case', guess, GUESS_OPACITY, 1]],
    },
  })
  // Stays on top of the lines that run through them: a dot with a white ring, of radius 5 px for a
  // short stop up to 9 px for an hour or more. White, like a location dot's, since the map can be light or
  // dark whatever the device's mode (Settings → Map style).
  addLayer({
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

  // The latest outing's walking as paw prints instead of the line close up, when the setting is on.
  for (const option of TRAIL_COLORS) {
    map.addImage(pawImage(option.id), drawPawPrints(trailColorOf(option.id, isDark(map))), { pixelRatio: PAW_PIXEL_RATIO })
  }
  map.addSource(PAWS, { type: 'geojson', data: empty.paws })
  addLayer({
    id: PAWS,
    type: 'symbol',
    source: PAWS,
    minzoom: PAW_ZOOM,
    layout: {
      visibility: 'none',
      // maplibre spaces the prints along each line and turns them to follow it: the icon's +x axis
      // points the way the line runs, oldest to newest, i.e. the direction of travel.
      'symbol-placement': 'line',
      'symbol-spacing': 44,
      'icon-image': ['concat', `${PAW_IMAGE}-`, ['coalesce', ['get', 'color'], DEFAULT_TRAIL_COLOR]],
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

/**
 * Each trail's colour (its feature's `color`, its asset's; see trailColors.ts), in its shade for a day
 * or night map (AssetMap's .map-light, .map-dark).
 */
function trailColors(map: MapLibreMap): ExpressionSpecification {
  const dark = isDark(map)
  const shades = TRAIL_COLORS.flatMap((option) => [option.id, trailColorOf(option.id, dark)])
  // A list of pairs, which maplibre's types can't follow.
  return ['match', ['get', 'color'], ...shades, trailColorOf(DEFAULT_TRAIL_COLOR, dark)] as unknown as ExpressionSpecification
}

/** Whether this is a night map (AssetMap's .map-dark). */
function isDark(map: MapLibreMap): boolean {
  return map.getContainer().classList.contains('map-dark')
}

/** The paw prints' image in a colour, by its id. */
function pawImage(color: string): string {
  return `${PAW_IMAGE}-${color}`
}

/** The --trail-casing colour for this map: white on a day map, dark on a night one. */
function casingColor(map: MapLibreMap): string {
  return getComputedStyle(map.getContainer()).getPropertyValue('--trail-casing').trim() || '#ffffff'
}
