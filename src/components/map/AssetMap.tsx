import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AttributionControl, LngLatBounds, MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// maplibre looks for its worker next to its own file, which breaks once bundled.
// Let Vite bundle the worker and hand maplibre the resulting same-origin URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { isStale, type Asset } from '../../lib/asset'
import type { Trails } from '../../lib/trail'
import type { LatLon } from '../../lib/segments'
import { useMyPosition, type MyPosition } from '../../lib/useMyPosition'
import { useNow } from '../../lib/useNow'
import { resolveStyle, type MapStyle } from '../../lib/mapStyles'
import { useSettings } from '../../lib/settings'
import { MapButtonControl } from './mapControls'
import { addMyPositionLayer, createMyPositionDot, MY_POSITION_ICON, setAccuracyCircle } from './myPosition'
import { circle } from './geometry'
import { createMarkerElement, updateMarkerElement } from './markers'
import { addTrailLayers, recolourTrails, setTrails, showPawPrints } from './trailLayers'
import { ZoomButtons } from './ZoomButtons'

setWorkerUrl(workerUrl)

const ASSET_ZOOM = 15
const ATTRIBUTION_SECONDS = 5
/** How long the map takes to glide to the followed asset's new position. */
const FOLLOW_MS = 1000
/** How close to the middle of the map (px) a selected asset counts as centred. */
const CENTRED_PX = 12
/** About how much of the map's bottom edge the bottom bar covers, in pixels. */
const BOTTOM_BAR = 68

/** Zoom when showing just your position. */
const MY_POSITION_ZOOM = 16

type Props = {
  assets: Asset[]
  trails: Trails
  /** Snap to paths: walks snapped to streets and paths, by walk key; others are drawn as recorded. */
  snappedWalks: Record<string, LatLon[]>
  /** The map styles to choose between (see mapStyles.ts), and the default. */
  styles: MapStyle[]
  defaultStyle: string
  selectedId: number | undefined
  /** Changes on every selection, so selecting the already-selected asset again re-centres on it. */
  focusToken: number
  onSelect: (id: number) => void
  onDeselect: () => void
  /**
   * Your own position, when a button outside the map turns it on and off (the map screen's bottom
   * bar). Without these the map has its own button among its controls (live link pages).
   */
  showMe?: boolean
  onShowMeChange?: (on: boolean) => void
  /**
   * Gets the map data's credits (HTML from the map style's sources) to show elsewhere, the
   * Settings card on the map screen. Without it the map shows them itself, as an ⓘ button.
   */
  onAttribution?: (attributions: string[]) => void
}

/** Browser-only: load with React.lazy inside <ClientOnly>. */
export default function AssetMap({
  assets,
  trails,
  snappedWalks,
  styles,
  defaultStyle,
  selectedId,
  focusToken,
  onSelect,
  onDeselect,
  showMe: showMeProp,
  onShowMeChange,
  onAttribution,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<number, Marker>())
  const onMarkerTapRef = useRef((_id: number) => {})
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

  // Moving the map yourself pauses following; zooming doesn't. The selection stays either way.
  // Only uses refs and a state setter, so the map's event handlers can keep the first one.
  const pauseFollowing = () => {
    if (!targetRef.current) return
    targetRef.current = null
    setPausedAt(focusTokenRef.current)
  }

  // Your own position (useMyPosition): off until a button turns it on, the bottom bar's or the
  // map's own. The first fix frames you and the selected asset together, or just you.
  const [ownShowMe, setOwnShowMe] = useState(false)
  const controlsMe = onShowMeChange !== undefined
  const showMe = controlsMe ? (showMeProp ?? false) : ownShowMe
  const setShowMe = onShowMeChange ?? setOwnShowMe
  const { position: me, note } = useMyPosition(showMe, () => setShowMe(false))
  const toggleMeRef = useRef(() => {})
  useEffect(() => {
    toggleMeRef.current = () => setShowMe(!showMe)
  })
  const ownButtonRef = useRef(!controlsMe)
  const onAttributionRef = useRef(onAttribution)
  useEffect(() => {
    onAttributionRef.current = onAttribution
  })
  const controlRef = useRef<MapButtonControl | null>(null)
  const meMarkerRef = useRef<Marker | null>(null)
  const framedRef = useRef(false)

  useEffect(() => {
    onMarkerTapRef.current = (id) => {
      const map = mapRef.current
      if (id !== selectedId || !map || !target) return onSelect(id)
      // The selected asset: deselect it when it's centred (or being followed); otherwise centre it
      // again, which also resumes following.
      const point = map.project([target.lon, target.lat])
      const container = map.getContainer()
      const offCentre = Math.hypot(point.x - container.clientWidth / 2, point.y - container.clientHeight / 2)
      if (following || offCentre <= CENTRED_PX) onDeselect()
      else onSelect(id)
    }
    focusTokenRef.current = focusToken
    targetRef.current = following ? [targetLon, targetLat] : null
  })

  // The map style: chosen with the map's style button and kept per browser, Auto following the
  // device's light or dark mode. Switching keeps the view; the trails are added to the new style.
  const [settings] = useSettings()
  const prefersDark = usePrefersDark()
  const styleChoice = settings.mapStyle ?? defaultStyle
  const styleUrl = resolveStyle(styles, styleChoice, defaultStyle, prefersDark).url
  const appliedStyleRef = useRef(styleUrl)

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: appliedStyleRef.current,
      center: [0, 20],
      zoom: 1,
      // Added below, at the top.
      attributionControl: false,
    })
    // On live link pages, maplibre's zoom and position buttons, top right. The map screen has its
    // own zoom buttons instead (ZoomButtons, below), matching the bottom bar.
    if (ownButtonRef.current) {
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      const control = new MapButtonControl('my-position-button', MY_POSITION_ICON, () => toggleMeRef.current(), {
        off: 'Show my position',
        on: 'Hide my position',
      })
      map.addControl(control, 'top-right')
      controlRef.current = control
    }
    // Every style load, the first and after switching: the trails and your position go on top.
    map.on('style.load', () => {
      addTrailLayers(map)
      addMyPositionLayer(map)
      setStyleLoaded(true)
    })
    // The map data's credits. On the map screen they're handed out to the Settings card, read from
    // the style's sources as they load (as maplibre's own control does), and the map shows none.
    let collapseAttribution: ReturnType<typeof setTimeout> | undefined
    if (onAttributionRef.current) {
      let reported = ''
      const report = () => {
        const sources = Object.keys(map.getStyle()?.sources ?? {})
        const credits = [...new Set(sources.map((id) => map.getSource(id)?.attribution).filter((text): text is string => !!text))]
        if (credits.join('\n') === reported) return
        reported = credits.join('\n')
        onAttributionRef.current?.(credits)
      }
      map.on('styledata', report)
      map.on('sourcedata', report)
    } else {
      // Elsewhere (live link pages), maplibre's ⓘ in the top-right corner, below the buttons. The
      // licence lets it shrink to the button. The first time the map opens in this browser it's
      // shown in full: maplibre collapses it on drag, and this does the same on a timer, counted
      // from when the style has loaded and the attribution has something to show. After that it
      // starts as the button. Marking the container compact up front stops maplibre from opening
      // it when the attributions arrive.
      map.addControl(new AttributionControl({ compact: true }), 'top-right')
      const attribution = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
      const firstTime = !attributionShown()
      if (!firstTime) attribution?.classList.add('maplibregl-compact')
      map.on('load', () => {
        if (!firstTime) return
        markAttributionShown()
        collapseAttribution = setTimeout(() => {
          attribution?.classList.remove('maplibregl-compact-show')
        }, ATTRIBUTION_SECONDS * 1000)
      })
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
      meMarkerRef.current = null
      controlRef.current = null
      map.remove()
      mapRef.current = null
      cameraPlacedRef.current = false
      setStyleLoaded(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedStyleRef.current === styleUrl) return
    appliedStyleRef.current = styleUrl
    setStyleLoaded(false)
    // A full reload rather than a diff, so 'style.load' fires and the trails are added again.
    map.setStyle(styleUrl, { diff: false })
  }, [styleUrl])

  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    setTrails(map, trails, snappedWalks)
  }, [trails, snappedWalks, styleLoaded])

  // Walks as a line or as paw prints (Appearance → Paw prints). Again after each style load, which
  // re-adds both layers.
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    showPawPrints(map, settings.pawPrints)
  }, [settings.pawPrints, styleLoaded])

  // Trail colour for light or dark mode. Runs after the page's .dark class has changed (see
  // public/color-scheme.js), so --trail already has the new mode's value.
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    recolourTrails(map)
  }, [prefersDark, styleLoaded])

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
        marker = new Marker({
          element: createMarkerElement(asset.id, onMarkerTapRef),
        })
          .setLngLat(lngLat)
          .addTo(map)
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
      map.flyTo(
        {
          center: [target.lon, target.lat],
          zoom: Math.max(map.getZoom(), ASSET_ZOOM),
        },
        { flightId },
      )
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
  }, [following])

  useEffect(() => {
    controlRef.current?.setOn(showMe)
    if (showMe) framedRef.current = false
  }, [showMe])

  // The blue dot and its accuracy circle.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (styleLoaded) setAccuracyCircle(map, me, me ? circle(me, me.accuracy) : [])
    if (!me) {
      meMarkerRef.current?.remove()
      meMarkerRef.current = null
      return
    }
    if (!meMarkerRef.current) meMarkerRef.current = new Marker({ element: createMyPositionDot() }).setLngLat([me.lon, me.lat]).addTo(map)
    else meMarkerRef.current.setLngLat([me.lon, me.lat])
  }, [me, styleLoaded])

  // On the first fix, show where you are: with the selected asset if there is one, which pauses
  // following (tapping the asset resumes it), or on its own.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !me || framedRef.current) return
    framedRef.current = true
    frameMe(map, me, target ?? undefined)
    if (target) pauseFollowing()
  }, [me])

  return (
    <>
      <div ref={containerRef} className="map" />
      {!ownButtonRef.current && <ZoomButtons map={mapRef} />}
      {note && (
        <p className="my-position-note" role="status">
          {note}
        </p>
      )}
    </>
  )
}

/** Whether the device is in dark mode, kept up to date. */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  )
}

function frameMe(map: MapLibreMap, me: MyPosition, asset: LatLon | undefined) {
  if (!asset) {
    map.flyTo({
      center: [me.lon, me.lat],
      zoom: Math.max(map.getZoom(), MY_POSITION_ZOOM),
    })
    return
  }
  const bounds = new LngLatBounds([me.lon, me.lat], [me.lon, me.lat]).extend([asset.lon, asset.lat])
  map.fitBounds(bounds, {
    padding: clearOfBottom(80),
    maxZoom: MY_POSITION_ZOOM + 1,
    duration: 800,
  })
}

const ATTRIBUTION_KEY = 'panopticon.attributionShown'

/** Whether the map's attribution has been shown in full in this browser (see the map's setup). */
function attributionShown(): boolean {
  try {
    return localStorage.getItem(ATTRIBUTION_KEY) === '1'
  } catch {
    return false
  }
}

function markAttributionShown() {
  try {
    localStorage.setItem(ATTRIBUTION_KEY, '1')
  } catch {
    // Storage unavailable: it's shown in full each time, as before.
  }
}

/** Even padding, plus room for the bottom bar along the map's bottom edge. */
function clearOfBottom(padding: number) {
  return {
    top: padding,
    right: padding,
    left: padding,
    bottom: padding + BOTTOM_BAR,
  }
}

function fitAll(map: MapLibreMap, assets: Asset[]) {
  const located = assets.flatMap((asset) => (asset.location ? [asset.location] : []))
  if (located.length === 0) return
  const bounds = new LngLatBounds()
  for (const { lon, lat } of located) bounds.extend([lon, lat])
  map.fitBounds(bounds, {
    padding: clearOfBottom(64),
    maxZoom: ASSET_ZOOM,
    duration: 0,
  })
}
