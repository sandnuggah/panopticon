import { useEffect, useRef, useState } from 'react'
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// maplibre looks for its worker next to its own file, which breaks once bundled.
// Let Vite bundle the worker and hand maplibre the resulting same-origin URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { isStale, type Asset } from '../lib/asset'
import type { ThemeId } from '../lib/theme'
import type { Trails } from '../lib/trail'
import { useNow } from '../lib/useNow'

setWorkerUrl(workerUrl)

const ASSET_ZOOM = 15
const TRAILS = 'trails'
const PAWS = 'paws'
const PAW_IMAGE = 'paw-prints'

type Props = {
  assets: Asset[]
  trails: Trails
  /** Dog park draws trails as paw prints instead of a line. */
  theme: ThemeId
  styleUrl: string
  selectedId: number | undefined
  /** Changes on every selection, so tapping the already-selected asset re-centres on it. */
  focusToken: number
  onSelect: (id: number) => void
}

/** Browser-only: load with React.lazy inside <ClientOnly>. */
export default function AssetMap({ assets, trails, theme, styleUrl, selectedId, focusToken, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<number, Marker>())
  const onSelectRef = useRef(onSelect)
  const cameraPlacedRef = useRef(false)
  const [styleLoaded, setStyleLoaded] = useState(false)
  const now = useNow(30_000)

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: styleUrl,
      center: [0, 20],
      zoom: 1,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      addTrailLayers(map)
      setStyleLoaded(true)
    })
    mapRef.current = map
    const markers = markersRef.current
    return () => {
      markers.clear()
      map.remove()
      mapRef.current = null
      cameraPlacedRef.current = false
      setStyleLoaded(false)
    }
  }, [styleUrl])

  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    void map.getSource<GeoJSONSource>(TRAILS)?.setData(toTrailFeatures(trails))
    void map.getSource<GeoJSONSource>(PAWS)?.setData(toPawFeatures(trails))
  }, [trails, styleLoaded])

  // Theme: trail colour, and line versus paw prints. Runs after <html data-theme> has changed,
  // so --trail already has the new theme's value.
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    const rgb = trailRgb()
    map.setPaintProperty(TRAILS, 'line-gradient', trailGradient(rgb))
    map.updateImage(PAW_IMAGE, drawPawPrints(rgb))
    const paws = theme === 'dog'
    map.setLayoutProperty(TRAILS, 'visibility', paws ? 'none' : 'visible')
    map.setLayoutProperty(PAWS, 'visibility', paws ? 'visible' : 'none')
  }, [theme, styleLoaded])

  // Keep one marker per located asset.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    const located = new Set<number>()
    for (const asset of assets) {
      if (!asset.location) continue
      located.add(asset.id)
      const lngLat: [number, number] = [asset.location.lon, asset.location.lat]
      let marker = markers.get(asset.id)
      if (marker) {
        marker.setLngLat(lngLat)
      } else {
        // A marker needs its position before it's added to the map.
        marker = new Marker({ element: createMarkerElement(asset.id, onSelectRef) }).setLngLat(lngLat).addTo(map)
        markers.set(asset.id, marker)
      }
      updateMarkerElement(marker.getElement(), asset, {
        stale: isStale(asset, now),
        selected: asset.id === selectedId,
      })
    }
    for (const [id, marker] of markers) {
      if (!located.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
  }, [assets, selectedId, now])

  // First render: show the selected asset, or fit all assets. Afterwards: fly to each new selection.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const target = assets.find((asset) => asset.id === selectedId)?.location
    if (!cameraPlacedRef.current) {
      cameraPlacedRef.current = true
      if (target) {
        map.jumpTo({ center: [target.lon, target.lat], zoom: ASSET_ZOOM })
      } else {
        fitAll(map, assets)
      }
    } else if (target) {
      map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), ASSET_ZOOM) })
    }
    // Deliberately not keyed on `assets`: only selections move the camera, not new positions.
  }, [selectedId, focusToken])

  return <div ref={containerRef} className="map" />
}

/**
 * Two ways to draw trails, one shown at a time by theme: a fading line, or paw prints. Markers are
 * DOM elements, so they always sit above both.
 */
function addTrailLayers(map: MapLibreMap) {
  const rgb = trailRgb()
  map.addSource(TRAILS, { type: 'geojson', data: toTrailFeatures({}), lineMetrics: true })
  map.addLayer({
    id: TRAILS,
    type: 'line',
    source: TRAILS,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 4, 'line-gradient': trailGradient(rgb) },
  })

  map.addImage(PAW_IMAGE, drawPawPrints(rgb), { pixelRatio: PAW_PIXEL_RATIO })
  map.addSource(PAWS, { type: 'geojson', data: toPawFeatures({}) })
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

/** Oldest point transparent, newest solid, so the direction of travel reads at a glance. */
function trailGradient([r, g, b]: [number, number, number]) {
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    `rgba(${r}, ${g}, ${b}, 0)`,
    1,
    `rgba(${r}, ${g}, ${b}, 0.9)`,
  ] as ExpressionSpecification
}

type TrailData = Parameters<GeoJSONSource['setData']>[0]

function toTrailFeatures(trails: Trails): TrailData {
  return {
    type: 'FeatureCollection',
    features: Object.entries(trails)
      .filter(([, points]) => points.length >= 2)
      .map(([id, points]) => ({
        type: 'Feature',
        properties: { id: Number(id) },
        geometry: { type: 'LineString', coordinates: points.map((point) => [point.lon, point.lat]) },
      })),
  }
}

/** Paw prints can't fade along a line the way a line gradient does, so split each trail into up to
 *  five pieces, oldest faintest. Neighbouring pieces share an end point so there are no gaps. */
function toPawFeatures(trails: Trails): TrailData {
  const PIECES = 5
  return {
    type: 'FeatureCollection',
    features: Object.entries(trails).flatMap(([id, points]) => {
      if (points.length < 2) return []
      const pieces = Math.min(PIECES, points.length - 1)
      const step = (points.length - 1) / pieces
      return Array.from({ length: pieces }, (_, piece) => {
        const from = Math.round(piece * step)
        const to = Math.round((piece + 1) * step)
        return {
          type: 'Feature' as const,
          properties: { id: Number(id), opacity: 0.35 + (0.65 * (piece + 1)) / pieces },
          geometry: {
            type: 'LineString' as const,
            coordinates: points.slice(from, to + 1).map((point) => [point.lon, point.lat]),
          },
        }
      })
    }),
  }
}

const PAW_PIXEL_RATIO = 2

/**
 * A left and a right paw print, staggered like a trotting dog, both pointing along +x. Drawn at
 * 2x for sharp edges. Drawn in code, so there's no image file to load.
 */
function drawPawPrints([r, g, b]: [number, number, number]): ImageData {
  const width = 56
  const height = 36
  const canvas = document.createElement('canvas')
  canvas.width = width * PAW_PIXEL_RATIO
  canvas.height = height * PAW_PIXEL_RATIO
  const context = canvas.getContext('2d')!
  context.scale(PAW_PIXEL_RATIO, PAW_PIXEL_RATIO)
  context.fillStyle = `rgb(${r}, ${g}, ${b})`
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

/** The theme's --trail colour as RGB; the map's paint properties can't read CSS variables. */
function trailRgb(): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--trail').trim()
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!match) return [47, 107, 79]
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)]
}

function fitAll(map: MapLibreMap, assets: Asset[]) {
  const located = assets.flatMap((asset) => (asset.location ? [asset.location] : []))
  if (located.length === 0) return
  const bounds = new LngLatBounds()
  for (const { lon, lat } of located) bounds.extend([lon, lat])
  map.fitBounds(bounds, { padding: 64, maxZoom: ASSET_ZOOM, duration: 0 })
}

function createMarkerElement(assetId: number, onSelectRef: { current: (id: number) => void }): HTMLElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'marker'
  element.innerHTML =
    '<span class="marker-dot"><span class="marker-initial"></span><img class="marker-image" alt="" hidden></span>' +
    '<span class="marker-label"></span>'
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
    onSelectRef.current(assetId)
  })
  return element
}

function updateMarkerElement(element: HTMLElement, asset: Asset, state: { stale: boolean; selected: boolean }) {
  element.classList.toggle('marker-stale', state.stale)
  element.classList.toggle('marker-selected', state.selected)
  element.setAttribute('aria-label', `Show ${asset.name}`)
  element.querySelector('.marker-initial')!.textContent = initial(asset.name)
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

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
