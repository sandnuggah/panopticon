import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ClientOnly, createFileRoute, isRedirect, redirect, useRouter } from '@tanstack/react-router'
import { AssetDetailsCard } from '../components/AssetDetailsCard'
import { LiveIndicator } from '../components/LiveIndicator'
import { UpdateNotice } from '../components/UpdateNotice'
import { BottomBar } from '../components/BottomBar'
import { PlaceBanner } from '../components/PlaceBanner'
import { PlaceEditor } from '../components/PlaceEditor'
import { parseSettingsView, SettingsCard, type SettingsView } from '../components/SettingsCard'
import { visitSentence, type PlaceVisit } from '../lib/places'
import type { LatLon } from '../lib/segments'
import { useSettings } from '../lib/settings'
import { useAddress } from '../lib/useAddress'
import { useLiveAssets } from '../lib/useLiveAssets'
import { useSnappedWalks } from '../lib/useSnappedWalks'
import { getAssets } from '../server/assets.functions'
import { getUser } from '../server/auth.functions'
import { getMapOptions } from '../server/map.functions'
import { getPlaces } from '../server/places.functions'

// maplibre needs a browser; keep it out of the server render and the initial bundle.
const AssetMap = lazy(() => import('../components/map/AssetMap'))

/**
 * The selected asset, whether its details card is open (`?asset=12&details=true`), the Settings
 * card's view while it's open (`?settings=main`, `?settings=asset-12`), and the place being edited
 * on the map (`?settings=places&place=3`, `place=new`), over the Places page it came from.
 */
type Search = { asset?: number; details?: true; settings?: SettingsView; place?: number | 'new' }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {}
    const asset = Number(search.asset)
    if (Number.isInteger(asset) && asset > 0) {
      result.asset = asset
      if (search.details === true || search.details === 'true') result.details = true
    }
    const settings = parseSettingsView(search.settings)
    if (settings) result.settings = settings
    const place = Number(search.place)
    if (search.place === 'new') result.place = 'new'
    else if (Number.isInteger(place) && place > 0) result.place = place
    return result
  },
  beforeLoad: async () => {
    const user = await getUser()
    // Not signed in: the front page, which explains the app and links to the sign-in page.
    if (!user) throw redirect({ to: '/welcome' })
    return { user }
  },
  loader: async () => {
    const [assets, mapOptions, places] = await Promise.all([
      getAssets(),
      getMapOptions(),
      // Without places the map still works.
      getPlaces().catch((error: unknown) => {
        // Signed out: go to /login like the other calls do.
        if (isRedirect(error)) throw error
        console.warn('Could not load places:', error)
        return []
      }),
    ])
    return { assets, mapOptions, places }
  },
  // Reload when arriving (e.g. after signing in). Selecting an asset or using the Settings card only
  // changes the search params ('stay'); live updates keep the map current.
  shouldReload: ({ cause }) => cause !== 'stay',
  component: Home,
})

function Home() {
  const loaderData = Route.useLoaderData()
  const { asset: selectedId, details, settings: cardView, place: editedPlace } = Route.useSearch()
  const { user } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const cards = useCardHistory({
    details: details === true,
    settings: cardView !== undefined,
    page: cardView !== undefined && cardView !== 'main',
    place: editedPlace !== undefined,
  })
  const [focusToken, setFocusToken] = useState(0)
  // Your own position on the map, turned on and off from the bottom bar.
  const [showMe, setShowMe] = useState(false)
  // The bottom bar's Settings button, which gets focus back when the Settings card closes.
  const settingsButton = useRef<HTMLButtonElement>(null)
  // The map data's credits, shown in the Settings card instead of on the map.
  const [attribution, setAttribution] = useState<string[]>([])
  const [settings, , settingsLoaded] = useSettings()
  const { places } = loaderData
  // "Betty left Home", while the app is open (see PlaceBanner).
  const [banner, setBanner] = useState<{ text: string; time: string; key: number; assetId: number } | null>(null)
  function announce(visits: PlaceVisit[]) {
    const visit = visits.at(-1)!
    const place = places.find((candidate) => candidate.id === visit.placeId)
    const asset = assets.find((candidate) => candidate.id === visit.assetId)
    if (!place || !asset) return
    setBanner({ text: visitSentence(asset.name, visit, place.name), time: visit.time, key: Date.now(), assetId: asset.id })
  }
  const { assets, trails, activities, stays, status, updateAvailable } = useLiveAssets(
    loaderData.assets,
    settingsLoaded ? settings.trail : null,
    announce,
  )
  const snappedWalks = useSnappedWalks(trails, loaderData.mapOptions.canSnapToPaths && settings.snapToPaths)
  const selected = assets.find((asset) => asset.id === selectedId)
  const address = useAddress(selected)

  // Adding or changing a place: the editor card at the bottom, the circle on the map above it.
  const editing = editedPlace !== undefined
  const placeKey = String(editedPlace)
  const place = editedPlace === 'new' ? null : places.find((candidate) => candidate.id === editedPlace)
  const [pick, setPick] = useState<{ key: string; radius: number; center: LatLon | null; inset: number }>({
    key: '',
    radius: 100,
    center: null,
    inset: 0,
  })
  // Each place opened starts from its own circle (state reset during render: React's derived-state pattern).
  if (editing && place !== undefined && pick.key !== placeKey) {
    setPick({ key: placeKey, radius: place?.area.kind === 'circle' ? place.area.radius : 100, center: null, inset: pick.inset })
  }
  const setRadius = useCallback((radius: number) => setPick((current) => ({ ...current, radius })), [])
  const setCenter = useCallback((center: LatLon) => setPick((current) => ({ ...current, center })), [])
  const setInset = useCallback((inset: number) => setPick((current) => (current.inset === inset ? current : { ...current, inset })), [])

  const openPlace = (id: number | 'new') => cards.open('place', (prev) => ({ settings: prev.settings, place: id }))
  const closePlace = () => cards.close('place', ({ place: _, ...rest }) => rest)
  // A place that's gone (removed here or in Traccar): back to the list.
  const placeGone = editing && place === undefined
  useEffect(() => {
    if (placeGone) closePlace()
  }, [placeGone])

  function select(id: number) {
    if (editing) return
    // Selecting replaces the search params, details card included.
    cards.forget('details')
    setFocusToken((token) => token + 1)
    void navigate({ search: { asset: id }, replace: true })
  }

  function deselect() {
    if (editing) return
    cards.forget('details')
    if (selectedId !== undefined) void navigate({ search: {}, replace: true })
  }

  /** A picture in the bottom bar: the first tap selects and centres the asset, the next re-centres it and opens its details. */
  function tapAsset(id: number) {
    if (id !== selectedId) return select(id)
    setFocusToken((token) => token + 1)
    if (!details) cards.open('details', (prev) => ({ ...prev, details: true }))
  }

  const closeDetails = () => cards.close('details', ({ details: _, ...rest }) => rest)
  const openSettings = () => cards.open('settings', (prev) => ({ ...prev, settings: 'main' }))

  function showSettings(view: SettingsView) {
    // From the Settings card into a page card: a history entry of its own, so the back gesture
    // returns to the Settings card. Within the page card, the entry is replaced.
    if (cardView === 'main' && view !== 'main') cards.open('page', (prev) => ({ ...prev, settings: view }))
    else cards.replace((prev) => ({ ...prev, settings: view }))
  }

  const closePage = () => cards.close('page', (prev) => ({ ...prev, settings: 'main' }))
  const closeSettings = () => cards.close('settings', ({ settings: _, ...rest }) => rest)

  const mapPlaceholder = <div className="map map-placeholder" />

  return (
    <main className="app">
      <div className="map-area">
        <div className="map-overlay">
          <LiveIndicator status={status} />
          {updateAvailable && <UpdateNotice />}
        </div>
        <ClientOnly fallback={mapPlaceholder}>
          <Suspense fallback={mapPlaceholder}>
            <AssetMap
              assets={assets}
              trails={trails}
              snappedWalks={snappedWalks}
              styles={loaderData.mapOptions.styles}
              defaultStyle={loaderData.mapOptions.defaultStyle}
              selectedId={editing ? undefined : selectedId}
              focusToken={focusToken}
              onSelect={select}
              onDeselect={deselect}
              buttons="above-bar"
              showMe={showMe}
              onShowMeChange={setShowMe}
              onAttribution={setAttribution}
              places={places}
              picker={
                editing && place !== undefined
                  ? {
                      placeId: place?.id,
                      start: place?.area ?? null,
                      startKey: placeKey,
                      radius: place === null || place.area.kind === 'circle' ? pick.radius : null,
                      bottomInset: pick.inset,
                      onCenter: setCenter,
                    }
                  : null
              }
            />
          </Suspense>
        </ClientOnly>
      </div>
      <PlaceBanner
        banner={banner}
        onTap={() => {
          if (banner) select(banner.assetId)
          setBanner(null)
        }}
        onDone={() => setBanner(null)}
      />
      <AssetDetailsCard
        asset={details && !editing ? selected : undefined}
        activity={selectedId !== undefined ? activities[selectedId] : undefined}
        stay={selectedId !== undefined ? stays[selectedId] : undefined}
        address={address}
        places={places}
        onTop={cardView === undefined}
        onClose={closeDetails}
      />
      <BottomBar
        userName={user.name}
        assets={assets}
        selectedId={selectedId}
        onAssetTap={tapAsset}
        showMe={showMe}
        onToggleMe={() => setShowMe((on) => !on)}
        settingsOpen={cardView !== undefined}
        onOpenSettings={openSettings}
        settingsButton={settingsButton}
      />
      <SettingsCard
        user={user}
        assets={assets}
        places={places}
        onOpenPlace={openPlace}
        mapStyles={loaderData.mapOptions}
        canSnapToPaths={loaderData.mapOptions.canSnapToPaths}
        attribution={attribution}
        view={editing ? undefined : cardView}
        onShow={showSettings}
        onClosePage={closePage}
        onClose={closeSettings}
        returnFocus={settingsButton}
      />
      {editing && place !== undefined && (
        <PlaceEditor
          key={placeKey}
          place={place}
          radius={pick.radius}
          onRadiusChange={setRadius}
          center={pick.center}
          onHeight={setInset}
          onClose={closePlace}
        />
      )}
    </main>
  )
}

type Card = 'details' | 'settings' | 'page' | 'place'

/**
 * The cards over the map (the details card, the Settings card and its page card) live in the search
 * params. Opening one here adds a history entry, so the back gesture closes the top card. Closing
 * one goes back past its entry and those of cards opened over it; a card the page loaded with has
 * no entry of its own, so closing it just changes the params. `isOpen` keeps the list honest when
 * the back gesture closes a card.
 */
function useCardHistory(isOpen: Record<Card, boolean>) {
  const navigate = Route.useNavigate()
  const router = useRouter()
  // The cards opened here, oldest first.
  const pushed = useRef<Card[]>([])
  // A card that was open and now isn't was closed some other way (the back gesture). Only that
  // change counts: a card just opened isn't open yet until the navigation lands.
  const wasOpen = useRef(isOpen)
  useEffect(() => {
    pushed.current = pushed.current.filter((card) => !wasOpen.current[card] || isOpen[card])
    wasOpen.current = isOpen
  })

  const replace = (search: (prev: Search) => Search) => void navigate({ search, replace: true })
  return {
    /** Opens a card, with a history entry of its own. */
    open(card: Card, search: (prev: Search) => Search) {
      pushed.current = [...pushed.current.filter((other) => other !== card), card]
      void navigate({ search })
    },
    /** Changes the params without a new entry, as when moving within a card. */
    replace,
    /** Closes a card, and any opened over it. */
    close(card: Card, search: (prev: Search) => Search) {
      const index = pushed.current.indexOf(card)
      if (index === -1) return replace(search)
      const entries = pushed.current.length - index
      pushed.current = pushed.current.slice(0, index)
      router.history.go(-entries)
    },
    /** Forgets a card's entry, when its params were replaced along with everything else. */
    forget(card: Card) {
      pushed.current = pushed.current.filter((other) => other !== card)
    },
  }
}
