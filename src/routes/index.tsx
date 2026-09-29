import { lazy, Suspense, useState } from 'react'
import { ClientOnly, createFileRoute, redirect } from '@tanstack/react-router'
import { AssetSheet } from '../components/AssetSheet'
import { LiveIndicator } from '../components/LiveIndicator'
import { SettingsLink } from '../components/SettingsLink'
import { useSettings } from '../lib/settings'
import { appName, useTheme } from '../lib/theme'
import { useAddress } from '../lib/useAddress'
import { useLiveAssets } from '../lib/useLiveAssets'
import { useSnappedWalks } from '../lib/useSnappedWalks'
import { getAssets } from '../server/assets.functions'
import { getUser } from '../server/auth.functions'
import { getMapOptions } from '../server/map.functions'

// maplibre needs a browser; keep it out of the server render and the initial bundle.
const AssetMap = lazy(() => import('../components/AssetMap'))

type Search = { asset?: number }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const asset = Number(search.asset)
    return Number.isInteger(asset) && asset > 0 ? { asset } : {}
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
  // Reload when arriving (e.g. back from settings). Selecting an asset only changes the search
  // params ('stay'); live updates keep the list current meanwhile.
  shouldReload: ({ cause }) => cause !== 'stay',
  component: Home,
})

function Home() {
  const loaderData = Route.useLoaderData()
  const { asset: selectedId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [focusToken, setFocusToken] = useState(0)
  const [settings, , settingsLoaded] = useSettings()
  const [theme] = useTheme()
  const { assets, trails, activities, status } = useLiveAssets(
    loaderData.assets,
    settingsLoaded ? settings.trailMinutes : null,
  )
  const snappedWalks = useSnappedWalks(trails, loaderData.mapOptions.followRoads && settings.followRoads)
  const address = useAddress(assets.find((asset) => asset.id === selectedId))

  function select(id: number) {
    setFocusToken((token) => token + 1)
    void navigate({ search: { asset: id }, replace: true })
  }

  function deselect() {
    if (selectedId !== undefined) void navigate({ search: {}, replace: true })
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
              theme={theme}
              styleUrl={loaderData.mapOptions.styleUrl}
              selectedId={selectedId}
              focusToken={focusToken}
              onSelect={select}
              onDeselect={deselect}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <AssetSheet
        assets={assets}
        activities={activities}
        selectedId={selectedId}
        selectedAddress={address}
        onSelect={select}
        onDeselect={deselect}
        // Shown in the desktop sidebar; on phones it's hidden visually but kept for screen readers.
        header={<h1 className="sheet-title">{appName(theme)}</h1>}
        footer={<SettingsLink />}
      />
    </main>
  )
}
