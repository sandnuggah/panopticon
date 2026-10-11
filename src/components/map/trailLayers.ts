import type { GeoJSONSource, MapLibreMap } from 'maplibre-gl'
import { walkKey } from '../../lib/matching'
import { classifyTrail, stayDots, type LatLon, type TrailPiece } from '../../lib/segments'
import type { TrailPoint, Trails } from '../../lib/trail'

// The trail on the map, drawn by what the asset was doing (see segments.ts): walking as a line, or
// as paw prints (Appearance → Paw prints); rides through their fixes, dashed, and dotted where they
// went without GPS (underground); stays as dots, bigger the longer they were, with the walks running
// through them, so a day reads as one path. Everything fades with age. Markers are DOM elements, so they always sit above all of it.

const TRAILS = 'trails'
const RIDES_VEHICLE = 'trail-vehicle'
const RIDES_UNDERGROUND = 'trail-underground'
const STAYS = 'trail-stays'
const PAWS = 'paws'
const PAW_IMAGE = 'paw-prints'
/** Walking is drawn in short pieces so the trail can fade with age, oldest faintest. */
const HOPS_PER_PIECE = 3

/** Shows these trails, snapping walks to paths where Snap to paths has them (see useSnappedWalks). */
export function setTrails(map: MapLibreMap, trails: Trails, snappedWalks: Record<string, LatLon[]>) {
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

type TrailData = Extract<Parameters<GeoJSONSource['setData']>[0], { type: 'FeatureCollection' }>
type TrailFeature = TrailData['features'][number]

/**
 * GeoJSON for the trail layers. `paws` holds the walking only, in longer pieces than `trail`:
 * paw prints are spaced 44 px apart, so short pieces would show none.
 */
function toTrailFeatures(trails: Trails, snappedWalks: Record<string, LatLon[]>): { trail: TrailData; paws: TrailData } {
  const trail: TrailFeature[] = []
  const paws: TrailFeature[] = []
  for (const [id, points] of Object.entries(trails)) {
    const fixes = points.filter((point) => point.valid)
    if (fixes.length === 0) continue
    // Oldest faintest: 0.2 at the start of the trail, 0.9 at its newest point.
    const [oldest, newest] = [fixes[0]!.time, fixes.at(-1)!.time]
    const opacity = (time: number) => 0.2 + 0.7 * (newest > oldest ? (time - oldest) / (newest - oldest) : 1)
    const line = (kind: string, coordinates: LatLon[], time: number): TrailFeature => ({
      type: 'Feature',
      properties: { id: Number(id), kind, opacity: opacity(time) },
      geometry: {
        type: 'LineString',
        coordinates: coordinates.map((point) => [point.lon, point.lat]),
      },
    })
    const pieces = classifyTrail(points)
    const stayIndexes = pieces.flatMap((piece, index) => (piece.kind === 'stay' ? [index] : []))
    const { dots, dotOf } = stayDots(stayIndexes.map((index) => pieces[index] as Extract<TrailPiece, { kind: 'stay' }>))
    /** The dot of the stay at `index` in the pieces, if there's a stay there. */
    const dotAt = (index: number) => {
      const stay = stayIndexes.indexOf(index)
      return stay < 0 ? undefined : dots[dotOf[stay]!]!
    }
    pieces.forEach((piece, index) => {
      if (piece.kind === 'move') {
        // From the dot of the stay before to the dot of the stay after, so the path is unbroken.
        const [before, after] = [dotAt(index - 1), dotAt(index + 1)]
        const walk = [
          ...(before ? [{ ...before.center, time: piece.points[0]!.time }] : []),
          ...alongPaths(piece.points, snappedWalks[walkKey(piece.points)]),
          ...(after ? [{ ...after.center, time: piece.points.at(-1)!.time }] : []),
        ]
        for (let i = 0; i < walk.length - 1; i += HOPS_PER_PIECE) {
          const chunk = walk.slice(i, i + HOPS_PER_PIECE + 1)
          trail.push(line('move', chunk, chunk.at(-1)!.time))
        }
        paws.push(line('move', walk, walk.at(-1)!.time))
      } else if (piece.kind !== 'stay') {
        // Through the fixes on the way; legs without GPS are straight lines, dotted.
        for (const leg of piece.legs) trail.push(line(leg.kind, leg.points, leg.points.at(-1)!.time))
      }
    })
    for (const dot of dots) {
      trail.push({
        type: 'Feature',
        properties: { id: Number(id), kind: 'stay', opacity: opacity(dot.to), minutes: dot.ms / 60_000 },
        geometry: { type: 'Point', coordinates: [dot.center.lon, dot.center.lat] },
      })
    }
  }
  return {
    trail: { type: 'FeatureCollection', features: trail },
    paws: { type: 'FeatureCollection', features: paws },
  }
}

/**
 * A walk as drawn: the snapped line when Snap to paths has one, else the fixes as recorded. The
 * snapped line has no times, so they're spread evenly between the walk's first and last fix, for fading.
 */
function alongPaths(points: TrailPoint[], snapped: LatLon[] | undefined): (LatLon & { time: number })[] {
  if (!snapped || snapped.length < 2) return points
  const [from, to] = [points[0]!.time, points.at(-1)!.time]
  return snapped.map((point, index) => ({
    ...point,
    time: from + ((to - from) * index) / (snapped.length - 1),
  }))
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
