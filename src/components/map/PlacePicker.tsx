import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, type MapLibreMap } from 'maplibre-gl'
import type { PlaceArea } from '../../lib/places'
import type { LatLon } from '../../lib/segments'

/** The part of the map a card covers, in px. */
export type Inset = { bottom: number; right: number }

/** A point to move the map to (an address found), and when it was asked for, so the same point can be asked for again. */
export type GoTo = { point: LatLon; at: number }

export type PickerProps = {
  /** Where to start: the place's area, or null for a new one, which starts where the map is. */
  start: PlaceArea | null
  /** Changes when a different place is opened, to move the map there again. */
  startKey: string
  /** The circle's radius in metres; null for a polygon, which can only be shown. */
  radius: number | null
  /**
   * How much of the map the editor card covers (px): its bottom on a phone, its right side on a wide
   * screen, where it's a side panel. The circle sits in the middle of the rest.
   */
  inset: Inset
  /** Moves the map, and so the circle, there. */
  goTo: GoTo | null
  /** The middle of the visible map, where the circle is, after each move. */
  onCenter: (center: LatLon) => void
}

/** Metres per CSS pixel at this latitude and zoom (maplibre's tiles are 512 px). */
function metresPerPixel(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/**
 * Placing a circle on the map: the circle stays in the middle of the map above the editor card and
 * the map moves under it, as in Find My. Drawn as a DOM circle over the map, so it stays round and
 * smooth during gestures.
 */
export function PlacePicker({
  map,
  theme,
  start,
  startKey,
  radius,
  inset,
  goTo,
  onCenter,
}: PickerProps & { map: { current: MapLibreMap | null }; theme: string }) {
  const [view, setView] = useState<{ lat: number; zoom: number; width: number; height: number } | null>(null)
  const onCenterRef = useRef(onCenter)
  const insetRef = useRef<Inset>({ bottom: 0, right: 0 })
  const radiusRef = useRef(radius ?? 100)
  useEffect(() => {
    onCenterRef.current = onCenter
    radiusRef.current = radius ?? 100
  })

  // Keep the circle's size and the centre up to date; leave the map's padding as it was afterwards.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const update = () => {
      const container = m.getContainer()
      setView({ lat: m.getCenter().lat, zoom: m.getZoom(), width: container.clientWidth, height: container.clientHeight })
    }
    const report = () => {
      const { lat, lng } = m.getCenter()
      onCenterRef.current({ lat, lon: lng })
    }
    m.on('move', update)
    m.on('moveend', report)
    update()
    return () => {
      m.off('move', update)
      m.off('moveend', report)
      m.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })
    }
  }, [map])

  // Go to the place (or where a new one starts), framed to leave room around it, once the editor
  // card has measured itself. After that, when the card's height changes (an error shows, the
  // keyboard), keep the same spot in the middle.
  const positionedFor = useRef<string | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m || (inset.bottom === 0 && inset.right === 0)) return
    const padding = { top: 0, left: 0, ...inset }
    if (positionedFor.current === startKey) {
      if (insetRef.current.bottom !== inset.bottom || insetRef.current.right !== inset.right) {
        m.easeTo({ center: m.getCenter(), padding, duration: 200 })
      }
      insetRef.current = inset
      return
    }
    positionedFor.current = startKey
    insetRef.current = inset
    if (start?.kind === 'polygon') {
      const bounds = new LngLatBounds()
      for (const point of start.ring) bounds.extend([point.lon, point.lat])
      m.fitBounds(bounds, { padding: { top: 48, left: 48, right: inset.right + 48, bottom: inset.bottom + 48 }, duration: 0 })
      return
    }
    const center = start ? start.center : { lat: m.getCenter().lat, lon: m.getCenter().lng }
    const container = m.getContainer()
    const visible = Math.min(container.clientWidth - inset.right, container.clientHeight - inset.bottom)
    // The circle across about 60% of the visible map.
    const zoom = Math.log2((40_075_016.686 * Math.cos((center.lat * Math.PI) / 180)) / (512 * ((radiusRef.current * 2) / (visible * 0.6))))
    m.jumpTo({ center: [center.lon, center.lat], zoom: Math.min(zoom, 18), padding })
  }, [map, startKey, inset.bottom, inset.right])

  useEffect(() => {
    const m = map.current
    if (!m || !goTo) return
    m.easeTo({ center: [goTo.point.lon, goTo.point.lat], padding: { top: 0, left: 0, ...insetRef.current }, duration: 600 })
  }, [map, goTo?.at])

  if (radius === null || !view) return null
  const size = (radius * 2) / metresPerPixel(view.lat, view.zoom)
  const middle = { x: (view.width - inset.right) / 2, y: (view.height - inset.bottom) / 2 }
  return (
    <div
      className={`place-picker ${theme}`}
      style={{ left: middle.x - size / 2, top: middle.y - size / 2, width: size, height: size }}
      aria-hidden="true"
    >
      <span className="place-picker-dot" />
    </div>
  )
}
