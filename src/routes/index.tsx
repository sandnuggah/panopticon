import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClientOnly, createFileRoute, isRedirect, redirect, useRouter } from '@tanstack/react-router'
import { AssetDetailsCard } from '../components/AssetDetailsCard'
import { LiveIndicator } from '../components/LiveIndicator'
import { UpdateNotice } from '../components/UpdateNotice'
import { BottomBar } from '../components/BottomBar'
import { NO_COVER, sameCover, type Cover } from '../components/cards'
import { PlaceBanner } from '../components/PlaceBanner'
import { PlaceEditor } from '../components/PlaceEditor'
import { LoadingScreen } from '../components/LoadingScreen'
import { parseSettingsView, SettingsCard, type SettingsView } from '../components/SettingsCard'
import type { Asset } from '../lib/asset'
import type { Park } from '../lib/parks'
import { visitSentence, type Place, type PlaceVisit } from '../lib/places'
import { trackersOf } from '../lib/tracker'
import type { LatLon } from '../lib/segments'
import type { GoTo, Inset } from '../components/map/PlacePicker'
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
  // Not awaited: the page goes out at once with the loading screen, and each part streams in as
  // Traccar answers it (see Home). Each settles to plain data: a redirect can't be streamed.
  loader: () => ({
    // When loading began, for the loading screen's times: from the page's start when the server
    // renders it (null), from now when moving here within the app.
    startedAt: typeof window === 'undefined' ? null : performance.now(),
    assets: settle(getAssets()),
    mapOptions: settle(getMapOptions()),
    // Without places the map still works.
    places: settle(
      getPlaces().catch((error: unknown) => {
        if (isRedirect(error)) throw error
        console.warn('Could not load places:', error)
        return [] as Place[]
      }),
    ),
  }),
  // Reload when arriving (e.g. after signing in). Selecting an asset or using the Settings card only
  // changes the search params ('stay'); live updates keep the map current.
  shouldReload: ({ cause }) => cause !== 'stay',
  // Nothing kept from an earlier visit (say, signed out): coming back loads afresh behind the loading screen.
  gcTime: 0,
  component: Home,
})

/** A streamed part of the page's data: its value, or why there's none (signed out: Traccar refused the token). */
type Settled<T> = { value: T } | { signedOut: true } | { failed: true }

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => (isRedirect(error) ? { signedOut: true as const } : { failed: true as const }),
  )
}

type MapData = {
  assets: Asset[]
  mapOptions: Awaited<ReturnType<typeof getMapOptions>>
  places: Place[]
}

/** What the loading screen waits for, in order. */
type Step = 'assets' | 'places' | 'map' | 'trails'

/** Once the map is ready, how long the loading screen waits for the trails before it goes anyway. */
const TRAILS_GRACE_MS = 2_000
/** Once the assets and places are in, how long it waits for the map (say its tiles can't load). */
const MAP_GRACE_MS = 8_000

/**
 * The map screen behind its loading screen. The loader's data arrives part by part; the map screen
 * appears once the assets, places and map options are in, and the loading screen fades out once the
 * map has drawn itself and the trails are in, or soon after. Reloads (reconnecting, coming back to
 * the tab) swap the new data in as it arrives, without the loading screen.
 */
function Home() {
  const loaderData = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [data, setData] = useState<Partial<MapData>>({})
  const [doneAt, setDoneAt] = useState<Partial<Record<Step, number>>>({})
  const [failed, setFailed] = useState(false)
  const [screen, setScreen] = useState<'loading' | 'leaving' | 'gone'>('loading')
  // Each step's time is from when loading began, the server's part included.
  const startedAt = useRef(loaderData.startedAt ?? 0)
  const finish = useCallback(
    (step: Step) =>
      setDoneAt((current) => (current[step] === undefined ? { ...current, [step]: performance.now() - startedAt.current } : current)),
    [],
  )

  useEffect(() => {
    let current = true
    const take =
      <K extends keyof MapData>(key: K, step?: Step) =>
      (result: Settled<MapData[K]>) => {
        if (!current) return
        if ('value' in result) {
          setData((previous) => ({ ...previous, [key]: result.value }))
          if (step) finish(step)
        } else if ('signedOut' in result) {
          // Traccar refused the token. The page had already gone out, so the server couldn't clear
          // the session cookie as it does otherwise. Asking again, not streamed, does: then it's the
          // sign-in page. If the session is fine after all, load the page's data again.
          current = false
          getAssets().then(
            () => void router.invalidate(),
            (error: unknown) => {
              if (isRedirect(error)) void router.navigate({ to: '/login' })
              else setFailed(true)
            },
          )
        } else {
          setFailed(true)
        }
      }
    setFailed(false)
    void loaderData.assets.then(take('assets', 'assets'))
    void loaderData.places.then(take('places', 'places'))
    void loaderData.mapOptions.then(take('mapOptions'))
    return () => {
      current = false
    }
  }, [loaderData])

  useEffect(() => {
    if (screen !== 'loading') return
    const leave = () => setScreen('leaving')
    if (doneAt.map !== undefined && doneAt.trails !== undefined) return leave()
    const wait = doneAt.map !== undefined ? TRAILS_GRACE_MS : doneAt.assets !== undefined && doneAt.places !== undefined ? MAP_GRACE_MS : 0
    if (wait === 0) return
    const timer = setTimeout(leave, wait)
    return () => clearTimeout(timer)
  }, [doneAt, screen])

  useEffect(() => {
    if (screen !== 'leaving') return
    // After the fade (styles.css .loading-screen).
    const timer = setTimeout(() => setScreen('gone'), 350)
    return () => clearTimeout(timer)
  }, [screen])

  const { assets, places, mapOptions } = data
  return (
    <>
      {assets && places && mapOptions && (
        <MapScreen
          data={{ assets, places, mapOptions }}
          user={user}
          loadingTrails={screen === 'gone' && doneAt.trails === undefined}
          onMapLoad={() => finish('map')}
          onTrailsLoaded={() => finish('trails')}
        />
      )}
      {screen !== 'gone' && (
        <LoadingScreen
          steps={[
            { label: assets ? `Your assets (${assets.length})` : 'Your assets', doneAt: doneAt.assets },
            { label: places ? `Places (${places.length})` : 'Places', doneAt: doneAt.places },
            { label: 'Map', doneAt: doneAt.map },
            { label: 'Trails', doneAt: doneAt.trails },
          ]}
          leaving={screen === 'leaving'}
          failed={failed}
          onRetry={() => void router.invalidate()}
        />
      )}
    </>
  )
}

type MapScreenProps = {
  data: MapData
  user: { name: string; email?: string }
  /** The loading screen has gone but the trails haven't come yet: a note by the Live pill. */
  loadingTrails: boolean
  onMapLoad: () => void
  onTrailsLoaded: () => void
}

function MapScreen({ data: loaderData, user, loadingTrails, onMapLoad, onTrailsLoaded }: MapScreenProps) {
  const { asset: selectedId, details, settings: cardView, place: editedPlace } = Route.useSearch()
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
  const { assets, trails, trailsLoaded, activities, stays, status, updateAvailable } = useLiveAssets(
    loaderData.assets,
    settingsLoaded ? settings.trail : null,
    places,
    announce,
  )
  useEffect(() => {
    if (trailsLoaded) onTrailsLoaded()
  }, [trailsLoaded])
  // Parks in the map's tiles (null until the map is ready), where walks are snapped more strictly.
  const [parks, setParks] = useState<Park[] | null>(null)
  const trackerKey = assets.map((asset) => `${asset.id}:${asset.tracker ?? ''}`).join(' ')
  const trackers = useMemo(() => trackersOf(assets), [trackerKey])
  const snappedWalks = useSnappedWalks(trails, loaderData.mapOptions.canSnapToPaths && settings.snapToPaths, parks, places, trackers)
  const selected = assets.find((asset) => asset.id === selectedId)
  const address = useAddress(selected)

  // What the cards cover of the map: the selected asset is centred in the rest.
  const [detailsCover, setDetailsCover] = useState(NO_COVER)
  const [settingsCover, setSettingsCover] = useState(NO_COVER)
  const onDetailsCover = useCallback((cover: Cover) => setDetailsCover((current) => (sameCover(current, cover) ? current : cover)), [])
  const onSettingsCover = useCallback((cover: Cover) => setSettingsCover((current) => (sameCover(current, cover) ? current : cover)), [])
  const mapCover: Cover = {
    top: Math.max(detailsCover.top, settingsCover.top),
    right: Math.max(detailsCover.right, settingsCover.right),
    bottom: Math.max(detailsCover.bottom, settingsCover.bottom),
    left: Math.max(detailsCover.left, settingsCover.left),
  }

  // Adding or changing a place: the editor card at the bottom, the circle on the map above it.
  const editing = editedPlace !== undefined
  const placeKey = String(editedPlace)
  const place = editedPlace === 'new' ? null : places.find((candidate) => candidate.id === editedPlace)
  const [pick, setPick] = useState<{ key: string; radius: number; center: LatLon | null; inset: Inset; goTo: GoTo | null }>({
    key: '',
    radius: 100,
    center: null,
    inset: { bottom: 0, right: 0 },
    goTo: null,
  })
  // Each place opened starts from its own circle (state reset during render: React's derived-state pattern).
  if (editing && place !== undefined && pick.key !== placeKey) {
    setPick({ key: placeKey, radius: place?.area.kind === 'circle' ? place.area.radius : 100, center: null, inset: pick.inset, goTo: null })
  }
  const setRadius = useCallback((radius: number) => setPick((current) => ({ ...current, radius })), [])
  const setCenter = useCallback((center: LatLon) => setPick((current) => ({ ...current, center })), [])
  const goTo = useCallback((point: LatLon) => setPick((current) => ({ ...current, goTo: { point, at: Date.now() } })), [])
  const setInset = useCallback(
    (inset: Inset) =>
      setPick((current) =>
        current.inset.bottom === inset.bottom && current.inset.right === inset.right ? current : { ...current, inset },
      ),
    [],
  )

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
          <div className="flex flex-col items-start gap-2">
            <LiveIndicator status={status} />
            {loadingTrails && (
              <span className="loading-trails inline-flex h-7 items-center gap-2 rounded-full px-3 text-[0.8125em] shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2">
                <span className="loading-spinner size-3.5" aria-hidden="true" />
                Loading trails
              </span>
            )}
          </div>
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
              onLoad={onMapLoad}
              onParks={setParks}
              cover={mapCover}
              places={places}
              picker={
                editing && place !== undefined
                  ? {
                      placeId: place?.id,
                      start: place?.area ?? null,
                      startKey: placeKey,
                      radius: place === null || place.area.kind === 'circle' ? pick.radius : null,
                      inset: pick.inset,
                      goTo: pick.goTo,
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
        onCover={onDetailsCover}
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
        onCover={onSettingsCover}
      />
      {editing && place !== undefined && (
        <PlaceEditor
          key={placeKey}
          place={place}
          radius={pick.radius}
          onRadiusChange={setRadius}
          center={pick.center}
          onInset={setInset}
          canSearch={loaderData.mapOptions.canSearchAddresses}
          onGoTo={goTo}
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
