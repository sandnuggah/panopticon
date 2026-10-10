import { lazy, Suspense, useCallback } from 'react'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { Page } from 'konsta/react'
import { AssetAvatar } from '../components/AssetAvatar'
import { LiveIndicator } from '../components/LiveIndicator'
import { RelativeTime } from '../components/RelativeTime'
import type { MapStyle } from '../lib/mapStyles'
import { formatTime, type SharedView } from '../lib/share'
import { useAddress } from '../lib/useAddress'
import { useNow } from '../lib/useNow'
import { useSharedAsset } from '../lib/useSharedAsset'
import { getMapOptions } from '../server/map.functions'
import { getSharedAddress, getSharedView } from '../server/liveLinks.functions'

// A live location link: one asset, followed live, for anyone with the link and without signing in.
// See liveLinks.server.ts for what it shows and how it ends.

const AssetMap = lazy(() => import('../components/AssetMap'))

const noTrails = {}
const nothing = () => {}

export const Route = createFileRoute('/s/$link')({
  loader: async ({ params }) => {
    const [view, mapOptions] = await Promise.all([getSharedView({ data: params.link }), getMapOptions()])
    return { view, styles: mapOptions.styles, defaultStyle: mapOptions.defaultStyle }
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
  const { view, styles, defaultStyle } = Route.useLoaderData()
  const { link } = Route.useParams()
  if (view.kind !== 'live') return <SharedEnded kind={view.kind} />
  return <SharedLive link={link} view={view} styles={styles} defaultStyle={defaultStyle} />
}

type LiveView = Extract<SharedView, { kind: 'live' }>

type LiveProps = { link: string; view: LiveView; styles: MapStyle[]; defaultStyle: string }

function SharedLive({ link, view, styles, defaultStyle }: LiveProps) {
  const { asset, status } = useSharedAsset(view.asset, link, view.expiresAt)
  const lookUp = useCallback(() => getSharedAddress({ data: link }), [link])
  const address = useAddress(asset, lookUp) ?? view.address ?? undefined
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
              styles={styles}
              defaultStyle={defaultStyle}
              selectedId={asset.id}
              focusToken={0}
              onSelect={nothing}
              onDeselect={nothing}
            />
          </Suspense>
        </ClientOnly>
      </div>
      {/* A floating panel over the map, with what a viewer may see. */}
      <section
        className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))]"
        aria-label={asset.name}
      >
        <div className="rounded-3xl p-4 shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-1 material:dark:bg-md-dark-surface-1">
          <div className="flex items-center gap-3">
            <AssetAvatar asset={asset} />
            <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{asset.name}</h1>
          </div>
          <div className="space-y-0.5 pt-3">
            {address && <p className="text-[17px] font-semibold">{address}</p>}
            <p className="opacity-60">
              {asset.location ? (
                <>
                  Seen <RelativeTime time={asset.location.fixTime} />
                </>
              ) : (
                'No location yet'
              )}
            </p>
            <p className="opacity-60" suppressHydrationWarning>
              Shared until {formatTime(view.expiresAt, now)}
            </p>
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
    <Page>
      <div className="mx-auto max-w-md px-6 pt-[20dvh] text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="pt-2 opacity-60">{text}</p>
      </div>
    </Page>
  )
}
