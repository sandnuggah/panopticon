import { lazy, Suspense, useState } from 'react'
import { ClientOnly, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { AssetSheet } from '../components/AssetSheet'
import { getAssets } from '../server/assets.functions'
import { getUser, logout } from '../server/auth.functions'
import { getMapStyleUrl } from '../server/map.functions'

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
    const [assets, mapStyleUrl] = await Promise.all([getAssets(), getMapStyleUrl()])
    return { assets, mapStyleUrl }
  },
  // Selecting an asset changes the URL; don't refetch from Traccar for that.
  staleTime: 30_000,
  component: Home,
})

function Home() {
  const { assets, mapStyleUrl } = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const { asset: selectedId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [focusToken, setFocusToken] = useState(0)

  function select(id: number) {
    setFocusToken((token) => token + 1)
    void navigate({ search: { asset: id }, replace: true })
  }

  async function onLogout() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  const mapPlaceholder = <div className="map map-placeholder" />

  return (
    <main className="app">
      <div className="map-area">
        <ClientOnly fallback={mapPlaceholder}>
          <Suspense fallback={mapPlaceholder}>
            <AssetMap
              assets={assets}
              styleUrl={mapStyleUrl}
              selectedId={selectedId}
              focusToken={focusToken}
              onSelect={select}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <AssetSheet
        assets={assets}
        selectedId={selectedId}
        onSelect={select}
        header={
          <>
            <h1>panopticon</h1>
            <span className="muted sheet-user">{user.name}</span>
            <button type="button" className="button-quiet" onClick={onLogout}>
              Sign out
            </button>
          </>
        }
      />
    </main>
  )
}
