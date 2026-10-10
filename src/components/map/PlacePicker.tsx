import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, type MapLibreMap } from 'maplibre-gl'
import type { PlaceArea } from '../../lib/places'
import type { LatLon } from '../../lib/segments'

export type PickerProps = {
  /** Where to start: the place's area, or null for a new one, which starts where the map is. */
  start: PlaceArea | null
  /** Changes when a different place is opened, to move the map there again. */
  startKey: string
  /** The circle's radius in metres; null for a polygon, which can only be shown. */
  radius: number | null
  /** How much of the map's bottom the editor card covers (px): the circle sits in the middle of the rest. */
  bottomInset: number
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
  start,
  startKey,
  radius,
  bottomInset,
  onCenter,
}: PickerProps & { map: { current: MapLibreMap | null } }) {
  const [view, setView] = useState<{ lat: number; zoom: number; width: number; height: number } | null>(null)
  const onCenterRef = useRef(onCenter)
  const insetRef = useRef(0)
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
    if (!m || bottomInset === 0) return
    if (positionedFor.current === startKey) {
      if (insetRef.current !== bottomInset) {
        m.easeTo({ center: m.getCenter(), padding: { top: 0, right: 0, left: 0, bottom: bottomInset }, duration: 200 })
      }
      insetRef.current = bottomInset
      return
    }
    positionedFor.current = startKey
    insetRef.current = bottomInset
    if (start?.kind === 'polygon') {
      const bounds = new LngLatBounds()
      for (const point of start.ring) bounds.extend([point.lon, point.lat])
      m.fitBounds(bounds, { padding: { top: 48, right: 48, left: 48, bottom: bottomInset + 48 }, duration: 0 })
      return
    }
    const center = start ? start.center : { lat: m.getCenter().lat, lon: m.getCenter().lng }
    const container = m.getContainer()
    const visible = Math.min(container.clientWidth, container.clientHeight - bottomInset)
    // The circle across about 60% of the visible map.
    const zoom = Math.log2((40_075_016.686 * Math.cos((center.lat * Math.PI) / 180)) / (512 * ((radiusRef.current * 2) / (visible * 0.6))))
    m.jumpTo({ center: [center.lon, center.lat], zoom: Math.min(zoom, 18), padding: { top: 0, right: 0, left: 0, bottom: bottomInset } })
  }, [map, startKey, bottomInset])

  if (radius === null || !view) return null
  const size = (radius * 2) / metresPerPixel(view.lat, view.zoom)
  const middle = { x: view.width / 2, y: (view.height - bottomInset) / 2 }
  return (
    <div
      className="place-picker"
      style={{ left: middle.x - size / 2, top: middle.y - size / 2, width: size, height: size }}
      aria-hidden="true"
    >
      <span className="place-picker-dot" />
    </div>
  )
}
