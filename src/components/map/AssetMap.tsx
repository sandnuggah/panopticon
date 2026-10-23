import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LngLatBounds, MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// maplibre looks for its worker next to its own file, which breaks once bundled.
// Let Vite bundle the worker and hand maplibre the resulting same-origin URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Asset } from '../../lib/asset'
import { assetStatus, isGrey, type AssetStatus } from '../../lib/status'
import { parkFromRings, type Park } from '../../lib/parks'
import type { Place } from '../../lib/places'
import type { Presence } from '../../lib/presence'
import { trailOptionsOf } from '../../lib/trail'
import type { TrailViews } from '../../lib/trailGeometry'
import type { LatLon } from '../../lib/segments'
import type { SnappedLines } from '../../lib/snapLines'
import { useMyPosition, type MyPosition } from '../../lib/useMyPosition'
import { useNow } from '../../lib/useNow'
import { resolveStyle, type MapStyle } from '../../lib/mapStyles'
import { useSettings } from '../../lib/settings'
import { addMyPositionLayer, createMyPositionDot, setAccuracyCircle } from './myPosition'
import { circle } from './geometry'
import {
  CAPSULE_TOP,
  createCapsule,
  createMarkerElement,
  createPlaceCount,
  ease,
  glideMarker,
  updateCapsule,
  updateMarkerElement,
  updatePlaceCount,
} from './markers'
import { addTrailLayers, recolourTrails, setTrails } from './trailLayers'
import { addPlaceLayers, recolourPlaces, setPlaces, showsPin } from './placeLayers'
import { NO_COVER, type Cover } from '../cards'
import { MapButtons } from './MapButtons'
import { PlacePicker, type PickerProps } from './PlacePicker'

setWorkerUrl(workerUrl)

const ASSET_ZOOM = 15
/** Assets at one place show in a pill from this zoom in; further out, as the place's pin with how many (markers.ts). */
const PILL_ZOOM = 17
/** How long the map takes to glide to the followed asset's new position. */
const FOLLOW_MS = 1000
/** How close to the middle of the map (px) a selected asset counts as centred. */
const CENTRED_PX = 12
/** About how much of the map's bottom edge the bottom bar covers, in pixels; it doesn't follow Dynamic Type. */
const BOTTOM_BAR = 76
/** How long the map takes to move along with a card opening or closing: as long as the card's slide. */
const CARD_MS = 300

/** Live link pages show no places; one empty list, so it never counts as a change. */
const NO_PLACES: Place[] = []
const NOWHERE: Record<number, Presence> = {}

/** Zoom when showing just your position. */
const MY_POSITION_ZOOM = 16

type Props = {
  assets: Asset[]
  /** Each asset's trail to draw (see useLiveAssets). */
  trails: TrailViews
  /** Snap to paths: the lines to draw walks along, by asset and walk (see useSnappedWalks); others are drawn as recorded. */
  snappedWalks: SnappedLines
  /** The map styles to choose between (see mapStyles.ts), and the default. */
  styles: MapStyle[]
  defaultStyle: string
  selectedId: number | undefined
  /** Changes on every selection, so selecting the already-selected asset again re-centres on it. */
  focusToken: number
  onSelect: (id: number) => void
  /** The selected asset's marker was tapped; the page decides what that does (see `centred`). */
  onSelectedTap: (id: number) => void
  /** Zooming out (yourself) past where the selected asset shows in its place's pill (PILL_ZOOM). */
  onDeselect?: () => void
  /**
   * Filled in by the map: whether the selected asset is centred (within 12 px of the middle of the
   * visible map, or being followed), for taps on it here or in the bottom bar.
   */
  centred?: { current: (() => boolean) | null }
  /** Where the map's buttons go (see MapButtons): above the bottom bar, or top right with your position. */
  buttons: 'above-bar' | 'top-right'
  /** Your own position on the map, turned on and off by the bottom bar or the map's buttons. */
  showMe: boolean
  onShowMeChange: (on: boolean) => void
  /**
   * Gets the map data's credits (HTML from the map style's sources), which the page shows: in the
   * Settings card on the map screen, in the panel on live link pages. The map shows none itself.
   */
  onAttribution: (attributions: string[]) => void
  /** Once, when the map has first drawn itself with its style and the tiles in view (the map screen's loading screen waits for it). */
  onLoad?: () => void
  /** The parks in the map's loaded tiles, once it's ready and after each move, for Snap to paths (see parks.ts). */
  onParks?: (parks: Park[]) => void
  /**
   * What the cards cover of the map (the details card, a side panel): the middle of the rest is
   * the map's middle, where a selected asset is centred and followed. The bottom bar counts too.
   */
  cover?: Cover
  /** The user's places (Settings → Places), drawn under the trail. None on live link pages. */
  places?: Place[]
  /** Where each asset is as its places go (see presence.ts), for the place it wears as a badge when zoomed out. */
  presence?: Record<number, Presence>
  /** What each asset is up to (see status.ts), greyed out when lost; without, from its last report alone (live link pages). */
  statuses?: Record<number, AssetStatus>
  /** While a place is being added or changed (PlaceEditor): the circle to place, and which place it is. */
  picker?: (PickerProps & { placeId?: number }) | null
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
  onSelectedTap,
  onDeselect,
  centred,
  buttons,
  showMe,
  onShowMeChange,
  onAttribution,
  onLoad,
  onParks,
  cover = NO_COVER,
  places = NO_PLACES,
  presence = NOWHERE,
  statuses,
  picker = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<number, Marker>())
  const onMarkerTapRef = useRef((_id: number) => {})
  /** Brings every marker up to date; again on each zoom, which decides the place badges (see markers.ts). */
  const updateMarkersRef = useRef(() => {})
  const cameraPlacedRef = useRef(false)
  const [styleLoaded, setStyleLoaded] = useState(false)
  /** Two or more assets at one place (markers.ts), by place id: their pill, and the place's pin with how many. */
  const groupsRef = useRef(new Map<number, { pill: Marker; count: Marker }>())
  /** The assets in one of them. */
  const capsuledRef = useRef(new Set<number>())
  const selectedIdRef = useRef(selectedId)
  const onDeselectRef = useRef(onDeselect)
  useEffect(() => {
    selectedIdRef.current = selectedId
    onDeselectRef.current = onDeselect
  })
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
  /** The zoom the selection flight under way is heading for. */
  const flightZoomRef = useRef(ASSET_ZOOM)

  // The visible map, as maplibre's padding: what the cards cover, and the bottom bar under them.
  const bar = buttons === 'above-bar' ? BOTTOM_BAR : 0
  const padding = { top: cover.top, right: cover.right, bottom: Math.max(cover.bottom, bar), left: cover.left }
  const paddingRef = useRef(padding)
  paddingRef.current = padding
  /** While the place picker is open, it sets the padding itself. */
  const pickingRef = useRef(false)
  pickingRef.current = picker !== null

  // Moving the map yourself pauses following; zooming doesn't. The selection stays either way.
  // Only uses refs and a state setter, so the map's event handlers can keep the first one.
  const pauseFollowing = () => {
    if (!targetRef.current) return
    targetRef.current = null
    setPausedAt(focusTokenRef.current)
  }

  // Your own position (useMyPosition): off until a button turns it on. The first fix frames you and
  // the selected asset together, or just you.
  const { position: me, note } = useMyPosition(showMe, () => onShowMeChange(false))
  const onAttributionRef = useRef(onAttribution)
  const onLoadRef = useRef(onLoad)
  const onParksRef = useRef(onParks)
  useEffect(() => {
    onAttributionRef.current = onAttribution
    onLoadRef.current = onLoad
    onParksRef.current = onParks
  })
  const meMarkerRef = useRef<Marker | null>(null)
  const framedRef = useRef(false)

  useEffect(() => {
    onMarkerTapRef.current = (id) => (id === selectedId && target ? onSelectedTap(id) : onSelect(id))
    if (centred) {
      centred.current = () => {
        const map = mapRef.current
        if (!map || !target) return false
        if (following) return true
        const point = map.project([target.lon, target.lat])
        const middle = visibleMiddle(map)
        return Math.hypot(point.x - middle.x, point.y - middle.y) <= CENTRED_PX
      }
    }
    focusTokenRef.current = focusToken
    targetRef.current = following ? [targetLon, targetLat] : null
  })

  // The map style: chosen with the map's style button and kept per browser, Auto following the
  // device's light or dark mode. Switching keeps the view; the trails are added to the new style.
  const [settings] = useSettings()
  const prefersDark = usePrefersDark()
  const styleChoice = settings.mapStyle ?? defaultStyle
  const style = resolveStyle(styles, styleChoice, defaultStyle, prefersDark)
  const styleUrl = style.url
  // What's drawn on the map takes the map's colours, day or night, whatever the device's mode: a
  // class on the map (styles.css .map-light, .map-dark) that the markers and the layers' colours read.
  const mapTheme = style.dark ? 'map-dark' : 'map-light'
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
    // Ready once a frame has drawn with the base map's tiles in view. maplibre's own 'load' (and
    // isStyleLoaded) wait for every source, the trail's and places' too, which their updates keep
    // putting off; so only the style's own sources count, as they are before ours are added.
    map.once('style.load', () => {
      const basemap = Object.keys(map.getStyle().sources)
      const onRender = () => {
        if (!basemap.every((id) => map.getSource(id) === undefined || map.isSourceLoaded(id))) return
        map.off('render', onRender)
        onLoadRef.current?.()
        onParksRef.current?.(parksInView(map))
        map.on('moveend', () => onParksRef.current?.(parksInView(map)))
      }
      map.on('render', onRender)
    })
    // Every style load, the first and after switching: places, then the trails and your position on top.
    map.on('style.load', () => {
      addPlaceLayers(map)
      addTrailLayers(map)
      addMyPositionLayer(map)
      setStyleLoaded(true)
    })
    // The map data's credits, read from the style's sources as they load (as maplibre's own
    // control does) and handed to the page, which shows them; the map shows none itself.
    let reported = ''
    const reportAttribution = () => {
      const sources = Object.keys(map.getStyle()?.sources ?? {})
      const credits = [...new Set(sources.map((id) => map.getSource(id)?.attribution).filter((text): text is string => !!text))]
      if (credits.join('\n') === reported) return
      reported = credits.join('\n')
      onAttributionRef.current(credits)
    }
    map.on('styledata', reportAttribution)
    map.on('sourcedata', reportAttribution)

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
      else return keepPadding()
      // After a selection flight or a zoom gesture (double-tap zooms around the tap, a pinch drifts),
      // catch up with the asset, which may have moved meanwhile.
      if (targetRef.current) map.easeTo({ center: targetRef.current, padding: paddingRef.current, duration: 300 })
      else keepPadding()
    })
    // A move that was to change the padding can be cut short (a drag, a newer move): once the map is
    // at rest, it gets the padding it should have, with a followed asset in the middle of it.
    const keepPadding = () => {
      if (pickingRef.current || map.isMoving() || samePadding(map.getPadding(), paddingRef.current)) return
      if (targetRef.current) map.easeTo({ center: targetRef.current, padding: paddingRef.current, duration: CARD_MS })
      else map.jumpTo(stillWith(map, paddingRef.current))
    }

    mapRef.current = map
    // From the start: the first move to a place (the place editor's jump to it) can come before the tiles.
    map.on('zoom', () => updateMarkersRef.current())
    // Zooming out yourself (a pinch, the wheel, −) past the pill hides the selected asset behind
    // its place's count: it's deselected. Not the app's own moves, such as a selection's flight in.
    let zoomingByHand = false
    map.on('zoomstart', (event) => {
      zoomingByHand = !!(event.originalEvent || (event as { byHand?: boolean }).byHand)
    })
    map.on('zoomend', () => {
      const selected = selectedIdRef.current
      if (zoomingByHand && map.getZoom() < PILL_ZOOM && selected !== undefined && capsuledRef.current.has(selected)) {
        onDeselectRef.current?.()
      }
    })
    const markers = markersRef.current
    const groups = groupsRef.current
    return () => {
      markers.clear()
      groups.clear()
      meMarkerRef.current = null
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

  // Each asset's trail colour (see trailColors.ts), new only when one changes, not with each position.
  const trailColorsKey = assets.map((asset) => `${asset.id}:${asset.trailColor ?? ''}`).join(' ')
  const trailColors = useMemo(
    () => Object.fromEntries(assets.flatMap((asset) => (asset.trailColor ? [[asset.id, asset.trailColor]] : []))),
    [trailColorsKey],
  )
  // The assets whose walks are paw prints close up (see trailOptionsOf), new only when one changes.
  const pawPrintsKey = assets.map((asset) => `${asset.id}:${trailOptionsOf(asset).pawPrints}`).join(' ')
  const pawPrints = useMemo(
    () => new Set(assets.filter((asset) => trailOptionsOf(asset).pawPrints).map((asset) => asset.id)),
    [pawPrintsKey],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    setTrails(map, trails, snappedWalks, trailColors, pawPrints)
  }, [trails, snappedWalks, trailColorsKey, pawPrintsKey, styleLoaded])

  const editedPlaceId = picker?.placeId
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map) return
    setPlaces(map, places, editedPlaceId)
  }, [places, editedPlaceId, styleLoaded])

  // Trail and place colours for a day or night map. Runs after the map's class has changed. That only happens with a switch to another map style, which
  // the effect above has just started loading; maplibre throws on the old layers then, and the new
  // style's layers get the new colours as they're added (style.load).
  useEffect(() => {
    const map = mapRef.current
    if (!styleLoaded || !map || !map.isStyleLoaded()) return
    recolourTrails(map)
    recolourPlaces(map)
  }, [mapTheme, styleLoaded])

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
        // Along with the camera following it (see FOLLOW_MS).
        glideMarker(marker, lngLat, FOLLOW_MS)
      } else {
        // A marker needs its position before it's added to the map.
        marker = new Marker({
          element: createMarkerElement(asset.id, onMarkerTapRef),
        })
          .setLngLat(lngLat)
          .addTo(map)
        markers.set(asset.id, marker)
      }
    }
    for (const [id, marker] of markers) {
      if (!located.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    // Two or more at one place (shown at its centre, see shownLocation): close in, a pill centred
    // under its pin with them in a row, in the bottom bar's order, each tappable; further out, its
    // pin with how many, which zooms in when tapped.
    const atPlaces = new Map<number, number[]>()
    for (const asset of assets) {
      const place = presence[asset.id]?.place
      if (asset.location && place !== null && place !== undefined) atPlaces.set(place, [...(atPlaces.get(place) ?? []), asset.id])
    }
    const capsuled = new Map<number, { index: number; count: number }>()
    const groups = groupsRef.current
    for (const [placeId, ids] of atPlaces) {
      const place = places.find((candidate) => candidate.id === placeId)
      if (ids.length < 2 || !place) continue
      ids.forEach((id, index) => capsuled.set(id, { index, count: ids.length }))
      const at = assets.find((asset) => asset.id === ids[0])!.location!
      const lngLat: [number, number] = [at.lon, at.lat]
      let group = groups.get(placeId)
      if (!group) {
        const zoomIn = () => map.flyTo({ center: group!.pill.getLngLat(), zoom: Math.max(map.getZoom(), PILL_ZOOM + 0.5) })
        group = {
          pill: new Marker({ element: createCapsule(), anchor: 'top', offset: [0, CAPSULE_TOP] }).setLngLat(lngLat).addTo(map),
          count: new Marker({ element: createPlaceCount(() => zoomIn()) }).setLngLat(lngLat).addTo(map),
        }
        groups.set(placeId, group)
      }
      group.pill.setLngLat(lngLat)
      group.count.setLngLat(lngLat)
      updateCapsule(group.pill.getElement(), ids.length)
      updatePlaceCount(
        group.count.getElement(),
        ids.map((id) => assets.find((asset) => asset.id === id)!.name),
        place.name,
      )
    }
    for (const [placeId, group] of groups) {
      if ((atPlaces.get(placeId)?.length ?? 0) >= 2 && places.some((place) => place.id === placeId)) continue
      group.pill.remove()
      group.count.remove()
      groups.delete(placeId)
    }
    capsuledRef.current = new Set(capsuled.keys())
    updateMarkersRef.current = () => {
      const close = map.getZoom() >= PILL_ZOOM
      for (const group of groups.values()) {
        group.pill.getElement().hidden = !close
        group.count.getElement().hidden = close
      }
      for (const asset of assets) {
        const marker = markers.get(asset.id)
        if (!marker) continue
        // At a place too small on screen to show its own pin: the asset wears it.
        const atPlace = places.find((place) => place.id === presence[asset.id]?.place && !showsPin(map, place))?.name
        const status = statuses?.[asset.id] ?? assetStatus(asset, { presence: presence[asset.id] }, now)
        updateMarkerElement(marker.getElement(), asset, {
          stale: isGrey(status),
          selected: asset.id === selectedId,
          atPlace,
          capsule: capsuled.has(asset.id) ? { ...capsuled.get(asset.id)!, close } : undefined,
        })
      }
    }
    updateMarkersRef.current()
  }, [assets, selectedId, now, places, presence, statuses])

  // First render: show the selected asset, or fit all assets. Afterwards: fly to each new selection.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const target = assets.find((asset) => asset.id === selectedId)?.location
    if (!cameraPlacedRef.current) {
      cameraPlacedRef.current = true
      map.setPadding(paddingRef.current)
      if (target) {
        map.jumpTo({ center: [target.lon, target.lat], zoom: ASSET_ZOOM })
      } else {
        fitAll(map, assets)
      }
    } else if (target) {
      const flightId = ++flightCountRef.current
      flightRef.current = flightId
      // An asset at a place with others shows close in, in their pill (see PILL_ZOOM).
      flightZoomRef.current = Math.max(map.getZoom(), capsuledRef.current.has(selectedId!) ? PILL_ZOOM + 0.5 : ASSET_ZOOM)
      // The id comes back on this flight's moveend, which then lets follow updates through.
      map.flyTo({ center: [target.lon, target.lat], zoom: flightZoomRef.current }, { flightId })
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
    map.easeTo({ center: [targetLon, targetLat], duration: FOLLOW_MS, easing: ease })
  }, [targetLon, targetLat, following])

  // When a card opens, closes or changes height, the middle of the visible map moves. A followed
  // asset goes along with the card, staying in the middle of what's visible (a selection flight on
  // its way there is re-aimed); otherwise the map stays put and only its middle moves. The place
  // picker sets the padding itself while it's open.
  const picking = picker !== null
  const paddingKey = `${padding.top} ${padding.right} ${padding.bottom} ${padding.left}`
  useEffect(() => {
    const map = mapRef.current
    if (!map || !cameraPlacedRef.current || picking) return
    if (samePadding(map.getPadding(), padding)) return
    const target = targetRef.current
    if (target) {
      const flying = flightRef.current !== null && map.isMoving()
      const flightId = ++flightCountRef.current
      flightRef.current = flightId
      if (flying) map.flyTo({ center: target, zoom: flightZoomRef.current, padding }, { flightId })
      else map.easeTo({ center: target, padding, duration: CARD_MS }, { flightId })
      return
    }
    map.jumpTo(stillWith(map, padding))
  }, [paddingKey, picking])

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
      <div ref={containerRef} className={`map ${mapTheme}`} />
      <MapButtons map={mapRef} placement={buttons} showMe={showMe} onToggleMe={() => onShowMeChange(!showMe)} />
      {picker && styleLoaded && <PlacePicker map={mapRef} theme={mapTheme} {...picker} />}
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
  // On top of the map's own padding, which keeps clear of the cards and the bottom bar.
  map.fitBounds(bounds, { padding: 80, maxZoom: MY_POSITION_ZOOM + 1, duration: 800 })
}

type Padding = { top: number; right: number; bottom: number; left: number }

function samePadding(a: Partial<Padding>, b: Padding): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

/** A new padding, with the map staying where it is: the point at the new middle becomes the centre. */
function stillWith(map: MapLibreMap, padding: Padding) {
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  const middle: [number, number] = [
    padding.left + (width - padding.left - padding.right) / 2,
    padding.top + (height - padding.top - padding.bottom) / 2,
  ]
  return { center: map.unproject(middle), padding }
}

/** The middle of the visible map (see the `cover` prop), in pixels. */
function visibleMiddle(map: MapLibreMap): { x: number; y: number } {
  const { top = 0, right = 0, bottom = 0, left = 0 } = map.getPadding()
  const { clientWidth: width, clientHeight: height } = map.getContainer()
  return { x: left + (width - left - right) / 2, y: top + (height - top - bottom) / 2 }
}

function fitAll(map: MapLibreMap, assets: Asset[]) {
  const located = assets.flatMap((asset) => (asset.location ? [asset.location] : []))
  if (located.length === 0) return
  const bounds = new LngLatBounds()
  for (const { lon, lat } of located) bounds.extend([lon, lat])
  map.fitBounds(bounds, { padding: 64, maxZoom: ASSET_ZOOM, duration: 0 })
}

/**
 * The parks in the map's loaded tiles, from the OpenMapTiles schema OpenFreeMap uses: city parks
 * are `landcover` with subclass `park` (OpenStreetMap's leisure=park), nature reserves the `park`
 * layer. Other map styles may have neither: no parks, and snapping is as everywhere else.
 */
function parksInView(map: MapLibreMap): Park[] {
  const parks: Park[] = []
  try {
    for (const [id, source] of Object.entries(map.getStyle().sources)) {
      if (source.type !== 'vector') continue
      for (const layer of ['landcover', 'park']) {
        for (const feature of map.querySourceFeatures(id, { sourceLayer: layer })) {
          if (layer === 'landcover' && feature.properties?.subclass !== 'park') continue
          const geometry = feature.geometry
          const polygons =
            geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
          for (const rings of polygons) {
            const park = parkFromRings(rings as [number, number][][])
            if (park) parks.push(park)
          }
        }
      }
    }
  } catch {
    // A style switch under way: no parks this time.
  }
  return parks
}
