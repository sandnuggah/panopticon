import { lazy, Suspense, useCallback } from 'react'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { AssetAvatar } from '../components/AssetAvatar'
import { LiveIndicator } from '../components/LiveIndicator'
import { RelativeTime } from '../components/RelativeTime'
import { formatTime, type SharedView } from '../lib/share'
import { useTheme } from '../lib/theme'
import { useAddress } from '../lib/useAddress'
import { useNow } from '../lib/useNow'
import { useSharedAsset } from '../lib/useSharedAsset'
import { getMapOptions } from '../server/map.functions'
import { getSharedAddress, getSharedView } from '../server/sharing.functions'

// A live location link: one asset, followed live, for anyone with the link and without signing in.
// See sharing.server.ts for what it shows and how it ends.

const AssetMap = lazy(() => import('../components/AssetMap'))

const noTrails = {}
const nothing = () => {}

export const Route = createFileRoute('/s/$link')({
  loader: async ({ params }) => {
    const [view, mapOptions] = await Promise.all([getSharedView({ data: params.link }), getMapOptions()])
    return { view, styleUrl: mapOptions.styleUrl }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.view.kind === 'live' ? `${loaderData.view.asset.name} · Live location` : 'Live location' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: SharedPage,
})

function SharedPage() {
  const { view, styleUrl } = Route.useLoaderData()
  const { link } = Route.useParams()
  if (view.kind !== 'live') return <SharedEnded kind={view.kind} />
  return <SharedLive link={link} view={view} styleUrl={styleUrl} />
}

type LiveView = Extract<SharedView, { kind: 'live' }>

function SharedLive({ link, view, styleUrl }: { link: string; view: LiveView; styleUrl: string }) {
  const { asset, status } = useSharedAsset(view.asset, link, view.expiresAt)
  const lookUp = useCallback(() => getSharedAddress({ data: link }), [link])
  const address = useAddress(asset, lookUp) ?? view.address ?? undefined
  const [theme] = useTheme()
  const now = useNow(30_000)
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
              assets={[asset]}
              trails={noTrails}
              snappedWalks={noTrails}
              theme={theme}
              styleUrl={styleUrl}
              selectedId={asset.id}
              focusToken={0}
              onSelect={nothing}
              onDeselect={nothing}
            />
          </Suspense>
        </ClientOnly>
      </div>
      <section className="sheet link-sheet" aria-label={asset.name}>
        <div className="link-details">
          <div className="asset-details-title">
            <AssetAvatar asset={asset} />
            <h1 className="asset-details-name">{asset.name}</h1>
          </div>
          <div className="asset-details-facts">
            {address && <span className="asset-card-address">{address}</span>}
            <span>
              {asset.location ? (
                <>
                  Seen <RelativeTime time={asset.location.fixTime} />
                </>
              ) : (
                'No location yet'
              )}
            </span>
            <span className="muted" suppressHydrationWarning>
              Shared until {formatTime(view.expiresAt, now)}
            </span>
          </div>
        </div>
      </section>
    </main>
  )
}

const endings: Record<Exclude<SharedView['kind'], 'live'>, { title: string; text: string }> = {
  expired: { title: 'This link has expired', text: 'Ask whoever shared it for a new one.' },
  stopped: { title: 'This link was stopped', text: "It's no longer shared. Ask whoever shared it for a new one." },
  invalid: { title: "This link doesn't work", text: 'Check that it was copied in full.' },
  unavailable: { title: "Can't show this right now", text: 'Try again in a minute.' },
}

function SharedEnded({ kind }: { kind: Exclude<SharedView['kind'], 'live'> }) {
  const { title, text } = endings[kind]
  return (
    <main className="page link-ended">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </main>
  )
}
