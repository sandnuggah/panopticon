import { lazy, Suspense, useRef, useState } from 'react'
import { ClientOnly, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { AssetCard } from '../components/AssetCard'
import { LiveIndicator } from '../components/LiveIndicator'
import { parseSettingsView, BottomBar, type SettingsView } from '../components/BottomBar'
import { useSettings } from '../lib/settings'
import { useAddress } from '../lib/useAddress'
import { useLiveAssets } from '../lib/useLiveAssets'
import { useSnappedWalks } from '../lib/useSnappedWalks'
import { getAssets } from '../server/assets.functions'
import { getUser } from '../server/auth.functions'
import { getMapOptions } from '../server/map.functions'

// maplibre needs a browser; keep it out of the server render and the initial bundle.
const AssetMap = lazy(() => import('../components/AssetMap'))

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
  const router = useRouter()
  // The history entries the details card, the Settings card and its page card added when opened
  // here, so closing goes back past them and the back gesture closes them one at a time. A page
  // loaded with a card open has none: closing it just drops the param.
  const pushed = useRef({ details: false, card: false, page: false })
  const [focusToken, setFocusToken] = useState(0)
  // Your own position on the map, turned on and off from the bottom bar.
  const [showMe, setShowMe] = useState(false)
  // The map data's credits, shown in the Settings card instead of on the map.
  const [attribution, setAttribution] = useState<string[]>([])
  const [settings, , settingsLoaded] = useSettings()
  const { assets, trails, activities, stays, status } = useLiveAssets(
    loaderData.assets,
    settingsLoaded ? settings.trail : null,
  )
  const snappedWalks = useSnappedWalks(trails, loaderData.mapOptions.followRoads && settings.followRoads)
  const selected = assets.find((asset) => asset.id === selectedId)
  const address = useAddress(selected)

  function select(id: number) {
    // Selecting replaces the search params, details card included.
    pushed.current.details = false
    setFocusToken((token) => token + 1)
    void navigate({ search: { asset: id }, replace: true })
  }

  function deselect() {
    pushed.current.details = false
    if (selectedId !== undefined) void navigate({ search: {}, replace: true })
  }

  /** A picture in the bottom bar: the first tap selects and centres the asset, the next re-centres it and opens its details. */
  function tapAsset(id: number) {
    if (id !== selectedId) return select(id)
    setFocusToken((token) => token + 1)
    if (details) return
    pushed.current.details = true
    void navigate({ search: (prev) => ({ ...prev, details: true }) })
  }

  function closeDetails() {
    if (pushed.current.details) {
      pushed.current.details = false
      router.history.back()
    } else {
      void navigate({ search: ({ details: _, ...rest }) => rest, replace: true })
    }
  }

  function openSettings() {
    pushed.current = { ...pushed.current, card: true, page: false }
    void navigate({ search: (prev) => ({ ...prev, settings: 'main' }) })
  }

  function showSettings(view: SettingsView) {
    // From the Settings card into a page card: a history entry of its own, so the back gesture
    // returns to the Settings card. Within the page card, the entry is replaced.
    const opensPage = cardView === 'main' && view !== 'main'
    if (opensPage) pushed.current.page = true
    void navigate({ search: (prev) => ({ ...prev, settings: view }), replace: !opensPage })
  }

  function closePage() {
    if (pushed.current.page) {
      pushed.current.page = false
      router.history.back()
    } else {
      void navigate({ search: (prev) => ({ ...prev, settings: 'main' }), replace: true })
    }
  }

  function closeSettings() {
    const entries = (pushed.current.card ? 1 : 0) + (pushed.current.page && cardView !== 'main' ? 1 : 0)
    pushed.current = { ...pushed.current, card: false, page: false }
    if (entries > 0) router.history.go(-entries)
    else void navigate({ search: ({ settings: _, ...rest }) => rest, replace: true })
  }

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
              showMe={showMe}
              onShowMeChange={setShowMe}
              onAttribution={setAttribution}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <AssetCard
        asset={details ? selected : undefined}
        activity={selectedId !== undefined ? activities[selectedId] : undefined}
        stay={selectedId !== undefined ? stays[selectedId] : undefined}
        address={address}
        onTop={cardView === undefined}
        onClose={closeDetails}
      />
      <BottomBar
        user={user}
        assets={assets}
        selectedId={selectedId}
        onAssetTap={tapAsset}
        attribution={attribution}
        mapStyles={loaderData.mapOptions}
        followRoads={loaderData.mapOptions.followRoads}
        showMe={showMe}
        onToggleMe={() => setShowMe((on) => !on)}
        view={cardView}
        onOpen={openSettings}
        onShow={showSettings}
        onClosePage={closePage}
        onClose={closeSettings}
      />
    </main>
  )
}
