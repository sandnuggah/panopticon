import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { RelativeTime } from '../components/RelativeTime'
import type { Asset } from '../lib/asset'
import { getAssets } from '../server/assets.functions'
import { getUser, logout } from '../server/auth.functions'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  loader: () => getAssets(),
  component: Home,
})

// Step 1: a plain list to prove sign-in and data loading. The map and bottom sheet come in step 2.
function Home() {
  const assets = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()

  async function onLogout() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="home">
      <header>
        <h1>panopticon</h1>
        <span className="muted">{user.name}</span>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </header>
      {assets.length === 0 ? (
        <p className="muted">No assets on this account yet.</p>
      ) : (
        <ul className="assets">
          {assets.map((asset) => (
            <AssetRow key={asset.id} asset={asset} />
          ))}
        </ul>
      )}
    </main>
  )
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <li>
      <strong>{asset.name}</strong>
      <span className={`status status-${asset.status}`}>{asset.status}</span>
      <span>
        {asset.location ? (
          <>
            Seen <RelativeTime time={asset.location.fixTime} />
          </>
        ) : (
          'No location yet'
        )}
      </span>
      {asset.lastUpdate && (
        <span className="muted">
          Last contact <RelativeTime time={asset.lastUpdate} />
        </span>
      )}
      {asset.location && (
        <span className="muted">
          {asset.location.lat.toFixed(5)}, {asset.location.lon.toFixed(5)}
          {asset.location.accuracy !== undefined && ` ±${Math.round(asset.location.accuracy)} m`}
        </span>
      )}
      {asset.battery?.percent !== undefined && <span>Battery {asset.battery.percent}%</span>}
      {asset.battery?.percent === undefined && asset.battery?.volts !== undefined && (
        <span>Battery {asset.battery.volts} V</span>
      )}
    </li>
  )
}
