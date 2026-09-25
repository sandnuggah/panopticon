import { useEffect, useRef } from 'react'
import { LngLatBounds, MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// maplibre looks for its worker next to its own file, which breaks once bundled.
// Let Vite bundle the worker and hand maplibre the resulting same-origin URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { isStale, type Asset } from '../lib/asset'
import { useNow } from '../lib/useNow'

setWorkerUrl(workerUrl)

const ASSET_ZOOM = 15

type Props = {
  assets: Asset[]
  styleUrl: string
  selectedId: number | undefined
  /** Changes on every selection, so tapping the already-selected asset re-centres on it. */
  focusToken: number
  onSelect: (id: number) => void
}

/** Browser-only: load with React.lazy inside <ClientOnly>. */
export default function AssetMap({ assets, styleUrl, selectedId, focusToken, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef(new Map<number, Marker>())
  const onSelectRef = useRef(onSelect)
  const cameraPlacedRef = useRef(false)
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
    mapRef.current = map
    const markers = markersRef.current
    return () => {
      markers.clear()
      map.remove()
      mapRef.current = null
      cameraPlacedRef.current = false
    }
  }, [styleUrl])

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
  element.innerHTML = '<span class="marker-dot"></span><span class="marker-label"></span>'
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
  element.querySelector('.marker-dot')!.textContent = initial(asset.name)
  element.querySelector('.marker-label')!.textContent = asset.name
}

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
