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
import { assetInitial, isStale, type Asset } from '../lib/asset'
import type { ThemeId } from '../lib/theme'
import type { Trails } from '../lib/trail'
import { useNow } from '../lib/useNow'

setWorkerUrl(workerUrl)

const ASSET_ZOOM = 15
const TRAILS = 'trails'
const PAWS = 'paws'
const PAW_IMAGE = 'paw-prints'
const ATTRIBUTION_SECONDS = 5
/** How long the map takes to glide to the followed asset's new position. */
const FOLLOW_MS = 1000

type Props = {
  assets: Asset[]
  trails: Trails
  /** Petopticon (the pet theme) draws trails as paw prints instead of a line. */
  theme: ThemeId
  styleUrl: string
  selectedId: number | undefined
  /** Changes on every selection, so selecting the already-selected asset again re-centres on it. */
  focusToken: number
  onMarkerTap: (id: number) => void
}

/** Browser-only: load with React.lazy inside <ClientOnly>. */
export default function AssetMap({
  assets,
  trails,
  theme,
  styleUrl,
  selectedId,
  focusToken,
  onMarkerTap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<number, Marker>())
  const onMarkerTapRef = useRef(onMarkerTap)
  const cameraPlacedRef = useRef(false)
  const [styleLoaded, setStyleLoaded] = useState(false)
  const now = useNow(30_000)

  // Following the selected asset: the map keeps its latest position centred. Dragging the map pauses
  // it (the asset stays selected) until the asset is tapped again or another one is selected; each
  // selection changes focusToken, so a pause only lasts for the selection it was made in.
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const focusTokenRef = useRef(focusToken)
  const target = assets.find((asset) => asset.id === selectedId)?.location
  const targetLon = target?.lon
  const targetLat = target?.lat
  const following = targetLon !== undefined && targetLat !== undefined && pausedAt !== focusToken
  /** Where the followed asset is now, for event handlers; null when not following. */
  const targetRef = useRef<[number, number] | null>(null)
  /** Id of the selection flight under way, if any. Follow updates wait for it to land. */
  const flightRef = useRef<number | null>(null)
  const flightCountRef = useRef(0)
  /** True during a user gesture (zoom, pinch, drag); follow updates wait for it to finish. */
  const gestureRef = useRef(false)

  useEffect(() => {
    onMarkerTapRef.current = onMarkerTap
    focusTokenRef.current = focusToken
    targetRef.current = following ? [targetLon, targetLat] : null
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
    // The map data's licence requires visible attribution, but lets it shrink to the (i) button
    // after a few seconds. Maplibre collapses it on drag; this does the same on a timer, counted
    // from when the style has loaded and the attribution has something to show.
    let collapseAttribution: ReturnType<typeof setTimeout> | undefined
    map.on('load', () => {
      addTrailLayers(map)
      setStyleLoaded(true)
      collapseAttribution = setTimeout(() => {
        map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      }, ATTRIBUTION_SECONDS * 1000)
    })

    // Moving the map yourself pauses following; zooming doesn't. The selection stays either way.
    const pauseFollowing = () => {
      if (!targetRef.current) return
      targetRef.current = null
      setPausedAt(focusTokenRef.current)
    }
    map.on('dragstart', (event) => {
      // A pinch also nudges the centre, which maplibre reports as a drag; that's zooming.
      const original = event.originalEvent
      if (typeof TouchEvent !== 'undefined' && original instanceof TouchEvent && original.touches.length > 1) return
      pauseFollowing()
    })
    map.on('movestart', (event) => {
      const original = event.originalEvent
      if (!original) return
      gestureRef.current = true
      // Arrow keys pan (with Shift they rotate and tilt instead).
      if (original instanceof KeyboardEvent && original.key.startsWith('Arrow') && !original.shiftKey) pauseFollowing()
    })
    map.on('moveend', (event) => {
      const endedFlight = (event as { flightId?: number }).flightId
      if (endedFlight !== undefined && endedFlight !== flightRef.current) return // replaced by a newer one
      if (endedFlight !== undefined) flightRef.current = null
      else if (event.originalEvent) gestureRef.current = false
      else return
      // After a selection flight or a zoom gesture (double-tap zooms around the tap, a pinch drifts),
      // catch up with the asset, which may have moved meanwhile.
      if (targetRef.current) map.easeTo({ center: targetRef.current, duration: 300 })
    })

    mapRef.current = map
    const markers = markersRef.current
    return () => {
      clearTimeout(collapseAttribution)
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
    const paws = theme === 'pet'
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
        marker = new Marker({ element: createMarkerElement(asset.id, onMarkerTapRef) }).setLngLat(lngLat).addTo(map)
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
      const flightId = ++flightCountRef.current
      flightRef.current = flightId
      // The id comes back on this flight's moveend, which then lets follow updates through.
      map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), ASSET_ZOOM) }, { flightId })
    }
    // Not keyed on `assets`: new positions of the selected asset are handled by following, below.
  }, [selectedId, focusToken])

  // Follow the selected asset's new positions, unless a selection flight or a zoom gesture is under
  // way; those catch up when they end (see moveend above).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !cameraPlacedRef.current || !following || targetLon === undefined || targetLat === undefined) return
    // Only while the map is actually moving, so a flag left behind can't stop following for good.
    if ((flightRef.current !== null || gestureRef.current) && map.isMoving()) return
    flightRef.current = null
    gestureRef.current = false
    map.easeTo({ center: [targetLon, targetLat], duration: FOLLOW_MS })
  }, [targetLon, targetLat, following])

  // While following, zoom gestures zoom around the centre (the asset), not the fingers or cursor.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const options = following ? ({ around: 'center' } as const) : undefined
    // scrollZoom.enable() ignores new options while already enabled.
    map.scrollZoom.disable()
    map.scrollZoom.enable(options)
    map.touchZoomRotate.enable(options)
  }, [following, styleUrl])

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

function createMarkerElement(assetId: number, onTapRef: { current: (id: number) => void }): HTMLElement {
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
    onTapRef.current(assetId)
  })
  return element
}

function updateMarkerElement(element: HTMLElement, asset: Asset, state: { stale: boolean; selected: boolean }) {
  element.classList.toggle('marker-stale', state.stale)
  element.classList.toggle('marker-selected', state.selected)
  element.setAttribute('aria-label', `Show ${asset.name}`)
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
