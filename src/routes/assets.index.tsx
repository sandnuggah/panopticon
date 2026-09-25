import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { AssetAvatar } from '../components/AssetAvatar'
import { getUser } from '../server/auth.functions'
import { getManagedAssets } from '../server/manage.functions'

export const Route = createFileRoute('/assets/')({
  beforeLoad: async () => {
    if (!(await getUser())) throw redirect({ to: '/login' })
  },
  loader: () => getManagedAssets(),
  head: () => ({ meta: [{ title: 'Assets · Panopticon' }] }),
  component: AssetsPage,
})

function AssetsPage() {
  const { access, assets } = Route.useLoaderData()

  return (
    <main className="page settings">
      <header className="settings-header">
        <Link to="/settings" className="button-quiet">
          ← Settings
        </Link>
        <h1>Assets</h1>
      </header>

      {!access.canEdit && (
        <p className="muted">Your Traccar account can't change assets. An administrator can allow it in Traccar.</p>
      )}

      {assets.length === 0 ? (
        <p className="muted">No assets on this account yet.</p>
      ) : (
        <ul className="manage-list">
          {assets.map((asset) => {
            const content = (
              <>
                <AssetAvatar asset={asset} />
                <span className="manage-row-name">
                  {asset.name}
                  {asset.disabled && <span className="muted"> · Disabled in Traccar</span>}
                </span>
              </>
            )
            return (
              <li key={asset.id}>
                {access.canEdit ? (
                  <Link to="/assets/$id" params={{ id: String(asset.id) }} className="manage-row">
                    {content}
                    <span className="manage-row-chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ) : (
                  <div className="manage-row">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {access.canAdd && (
        <Link to="/assets/new" className="button-primary">
          Add asset
        </Link>
      )}
    </main>
  )
}
