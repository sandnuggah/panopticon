import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ClientOnly, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { AssetDetailsCard } from '../components/AssetDetailsCard'
import { LiveIndicator } from '../components/LiveIndicator'
import { BottomBar } from '../components/BottomBar'
import { parseSettingsView, SettingsCard, type SettingsView } from '../components/SettingsCard'
import { useSettings } from '../lib/settings'
import { useAddress } from '../lib/useAddress'
import { useLiveAssets } from '../lib/useLiveAssets'
import { useSnappedWalks } from '../lib/useSnappedWalks'
import { getAssets } from '../server/assets.functions'
import { getUser } from '../server/auth.functions'
import { getMapOptions } from '../server/map.functions'

// maplibre needs a browser; keep it out of the server render and the initial bundle.
const AssetMap = lazy(() => import('../components/map/AssetMap'))

/**
 * The selected asset, whether its details card is open (`?asset=12&details=true`), and the Settings
 * card's view while it's open (`?settings=main`, `?settings=asset-12`).
 */
type Search = { asset?: number; details?: true; settings?: SettingsView }

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
    return result
  },
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: async () => {
    const [assets, mapOptions] = await Promise.all([getAssets(), getMapOptions()])
    return { assets, mapOptions }
  },
  // Reload when arriving (e.g. after signing in). Selecting an asset or using the Settings card only
  // changes the search params ('stay'); live updates keep the map current.
  shouldReload: ({ cause }) => cause !== 'stay',
  component: Home,
})

function Home() {
  const loaderData = Route.useLoaderData()
  const { asset: selectedId, details, settings: cardView } = Route.useSearch()
  const { user } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const cards = useCardHistory({
    details: details === true,
    settings: cardView !== undefined,
    page: cardView !== undefined && cardView !== 'main',
  })
  const [focusToken, setFocusToken] = useState(0)
  // Your own position on the map, turned on and off from the bottom bar.
  const [showMe, setShowMe] = useState(false)
  // The bottom bar's Settings button, which gets focus back when the Settings card closes.
  const settingsButton = useRef<HTMLButtonElement>(null)
  // The map data's credits, shown in the Settings card instead of on the map.
  const [attribution, setAttribution] = useState<string[]>([])
  const [settings, , settingsLoaded] = useSettings()
  const { assets, trails, activities, stays, status } = useLiveAssets(loaderData.assets, settingsLoaded ? settings.trail : null)
  const snappedWalks = useSnappedWalks(trails, loaderData.mapOptions.canSnapToPaths && settings.snapToPaths)
  const selected = assets.find((asset) => asset.id === selectedId)
  const address = useAddress(selected)

  function select(id: number) {
    // Selecting replaces the search params, details card included.
    cards.forget('details')
    setFocusToken((token) => token + 1)
    void navigate({ search: { asset: id }, replace: true })
  }

  function deselect() {
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
        </div>
        <ClientOnly fallback={mapPlaceholder}>
          <Suspense fallback={mapPlaceholder}>
            <AssetMap
              assets={assets}
              trails={trails}
              snappedWalks={snappedWalks}
              styles={loaderData.mapOptions.styles}
              defaultStyle={loaderData.mapOptions.defaultStyle}
              selectedId={selectedId}
              focusToken={focusToken}
              onSelect={select}
              onDeselect={deselect}
              buttons="above-bar"
              showMe={showMe}
              onShowMeChange={setShowMe}
              onAttribution={setAttribution}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <AssetDetailsCard
        asset={details ? selected : undefined}
        activity={selectedId !== undefined ? activities[selectedId] : undefined}
        stay={selectedId !== undefined ? stays[selectedId] : undefined}
        address={address}
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
        mapStyles={loaderData.mapOptions}
        canSnapToPaths={loaderData.mapOptions.canSnapToPaths}
        attribution={attribution}
        view={cardView}
        onShow={showSettings}
        onClosePage={closePage}
        onClose={closeSettings}
        returnFocus={settingsButton}
      />
    </main>
  )
}

type Card = 'details' | 'settings' | 'page'

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
