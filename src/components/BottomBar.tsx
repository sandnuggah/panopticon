import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { BlockFooter, List, ListButton, ListItem } from 'konsta/react'
import { isStale, type Asset } from '../lib/asset'
import { useLiveLinks } from '../lib/liveLinks'
import type { MapStyle } from '../lib/mapStyles'
import { useNow } from '../lib/useNow'
import { logout } from '../server/auth.functions'
import type { SessionUser } from '../server/session.server'
import { AddAssetForm } from './AddAssetForm'
import { AssetAvatar } from './AssetAvatar'
import { AssetEditor } from './AssetEditor'
import { AssetsList } from './AssetsList'
import { Backdrop, CARD_BG, CloseButton, pageCardClass, ROWS } from './cards'
import { LiveLinksList } from './LiveLinksList'
import { AppearanceSettings } from './Appearance'

/**
 * What's open: the Settings card alone (`main`), or the page card over it. Assets opens the list of
 * assets, which opens Add asset or an asset's own page (`asset-12`) inside the same card.
 */
export type SettingsView = 'main' | 'appearance' | 'live-links' | 'account' | 'assets' | 'add-asset' | `asset-${number}`

/** The view a `settings` search param names, or undefined when it names none. */
export function parseSettingsView(value: unknown): SettingsView | undefined {
  const named: unknown[] = ['main', 'appearance', 'live-links', 'account', 'assets', 'add-asset']
  if (named.includes(value)) return value as SettingsView
  if (typeof value === 'string' && /^asset-[1-9]\d{0,9}$/.test(value)) return value as SettingsView
  return undefined
}

function assetIdOf(view: SettingsView): number | undefined {
  return view.startsWith('asset-') ? Number(view.slice('asset-'.length)) : undefined
}

/** Add asset and an asset's page open inside the Assets card, with "‹ Assets" back. */
function insideAssets(view: SettingsView): boolean {
  return view === 'add-asset' || assetIdOf(view) !== undefined
}

type Props = {
  user: SessionUser
  /** The assets on the map: their pictures in the bar, the Assets count, an asset page's title. */
  assets: Asset[]
  selectedId: number | undefined
  /** A picture in the bar was tapped: select and centre that asset, or, when it's selected, show its details. */
  onAssetTap: (id: number) => void
  /** The map styles to choose between, and the server's default (see mapStyles.ts). */
  mapStyles: { styles: MapStyle[]; defaultStyle: string }
  /** Whether the server has map matching, so Follow roads can be offered. */
  followRoads: boolean
  /** The map data's credits, HTML from the map style's sources (see AssetMap's onAttribution). */
  attribution: string[]
  /** Whether your own position shows on the map, and the bar's button that turns it on and off. */
  showMe: boolean
  onToggleMe: () => void
  /** What's open, or undefined while nothing is (the map route's `settings` search param). */
  view: SettingsView | undefined
  onOpen: () => void
  /** Shows a view: opens the page card from the Settings card, or moves within the page card. */
  onShow: (view: SettingsView) => void
  /** Closes the page card, back to the Settings card. */
  onClosePage: () => void
  /** Closes everything, back to the map. */
  onClose: () => void
}

/**
 * The bar floating at the bottom of the map, like Apple Maps' search bar: your position on and off
 * at its left end, each asset's picture, and the Settings button (your initial) at its right. That
 * opens the Settings card from the bottom, like Apple Maps' profile card: who's signed in, and
 * Assets, Appearance, Live links and Account. Each of those opens a second card from the bottom
 * that covers the screen, like Apple Maps' Places, with a large title and ✕ back to the Settings
 * card. Add asset and an asset's own page open inside the Assets card.
 *
 * Not Konsta's Sheet: that's position: fixed, and fixed elements stop 59 pt short of the screen's
 * bottom in the iOS home-screen app (see styles.css). These are absolute inside the map screen.
 */
export function BottomBar({
  user,
  assets,
  selectedId,
  onAssetTap,
  attribution,
  mapStyles,
  followRoads,
  showMe,
  onToggleMe,
  view,
  onOpen,
  onShow,
  onClosePage,
  onClose,
}: Props) {
  const now = useNow(30_000)
  const open = view !== undefined
  const pageOpen = open && view !== 'main'
  const button = useRef<HTMLButtonElement>(null)
  const settingsClose = useRef<HTMLButtonElement>(null)
  const pageHeader = useRef<HTMLButtonElement>(null)
  // While the page card slides away it keeps showing what it showed.
  const lastPage = useRef<Exclude<SettingsView, 'main'>>('assets')
  const page = pageOpen ? (view as Exclude<SettingsView, 'main'>) : lastPage.current
  // Within the Assets card, pages slide in sideways: forward into an asset, back to the list.
  const before = useRef({ open, pageOpen, page })
  const slide =
    !before.current.pageOpen || !pageOpen || before.current.page === page
      ? ''
      : insideAssets(page)
        ? 'card-view-forward'
        : insideAssets(before.current.page)
          ? 'card-view-back'
          : ''

  useEffect(() => {
    if (pageOpen) lastPage.current = page
    const was = before.current
    before.current = { open, pageOpen, page }
    // Without preventScroll the browser scrolls the map screen to bring the button into view
    // while a card is still sliding, and the whole screen jumps.
    if (pageOpen) pageHeader.current?.focus({ preventScroll: true })
    else if (open) settingsClose.current?.focus({ preventScroll: true })
    else if (was.open) button.current?.focus({ preventScroll: true })
  }, [open, pageOpen, page])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pageOpen) onClosePage()
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pageOpen, onClose, onClosePage])

  const assetId = assetIdOf(page)
  const title =
    page === 'appearance'
      ? 'Appearance'
      : page === 'live-links'
        ? 'Live links'
        : page === 'account'
          ? 'Account'
          : page === 'assets'
            ? 'Assets'
            : page === 'add-asset'
              ? 'Add asset'
              : (assets.find((asset) => asset.id === assetId)?.name ?? 'Asset')

  return (
    <>
      <div className="bottom-bar absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between rounded-full px-1.5 shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2">
          <button
            type="button"
            className={`grid size-11 place-items-center rounded-full active:opacity-60 ${showMe ? 'text-primary' : ''}`}
            aria-label={showMe ? 'Hide my position' : 'Show my position'}
            aria-pressed={showMe}
            onClick={onToggleMe}
          >
            <LocationIcon filled={showMe} />
          </button>
          {/* Each asset's picture: the first tap centres it on the map, the next opens its details. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1.5 [scrollbar-width:none]">
            {assets.map((asset) => {
              const selected = asset.id === selectedId
              return (
                <button
                  key={asset.id}
                  type="button"
                  className="shrink-0 rounded-full p-0.5 active:opacity-60"
                  aria-label={selected ? `${asset.name}: details` : `Show ${asset.name}`}
                  onClick={() => onAssetTap(asset.id)}
                >
                  <AssetAvatar asset={asset} stale={isStale(asset, now)} />
                </button>
              )
            })}
          </div>
          <button
            ref={button}
            type="button"
            className="rounded-full active:opacity-60"
            aria-label="Settings"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={onOpen}
          >
            <Initial name={user.name} className="size-11 text-lg" />
          </button>
        </div>
      </div>

      {/* The Settings card. */}
      <Backdrop shown={open} z="z-30" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        inert={!open || pageOpen}
        className={`absolute inset-x-0 bottom-0 z-40 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out ${open ? '' : 'translate-y-full'}`}
      >
        {/* Just tall enough for the main list and the map credits under it, or less on short screens. */}
        <div
          className={`relative h-[min(472px,calc(100dvh-env(safe-area-inset-top)-96px))] overflow-y-auto rounded-[2.5rem] pt-5 shadow-2xl ${CARD_BG}`}
        >
          <CloseButton ref={settingsClose} className="absolute right-4 top-4 z-10" onClick={onClose} />
          <MainView user={user} assetCount={assets.length} attribution={attribution} onShow={onShow} />
        </div>
      </section>

      {/* The page card, over the Settings card, from just below the status bar to the bottom. */}
      <Backdrop shown={pageOpen} z="z-50" onClick={onClosePage} />
      <section role="dialog" aria-modal="true" aria-label={title} inert={!pageOpen} className={pageCardClass(pageOpen)}>
        <div className={`flex h-full flex-col overflow-clip rounded-t-[2.5rem] shadow-2xl ${CARD_BG}`}>
          {insideAssets(page) ? (
            <div className="relative flex h-15 shrink-0 items-center justify-between px-4 pt-4">
              <button
                ref={pageHeader}
                type="button"
                className="flex items-center gap-0.5 pr-2 text-primary active:opacity-50"
                onClick={() => onShow('assets')}
              >
                <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M12.5 4 6.5 10l6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Assets
              </button>
              <h2 className="absolute inset-x-28 truncate text-center text-[17px] font-semibold">{title}</h2>
              <CloseButton onClick={onClosePage} />
            </div>
          ) : (
            <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-5">
              <h2 className="truncate text-[34px] font-bold">{title}</h2>
              <CloseButton ref={pageHeader} onClick={onClosePage} />
            </div>
          )}
          <div key={page} className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[env(safe-area-inset-bottom)] ${slide}`}>
            {page === 'appearance' && <AppearanceSettings listColors={ROWS} {...mapStyles} followRoads={followRoads} />}
            {page === 'live-links' && <LiveLinksList listColors={ROWS} />}
            {page === 'account' && <AccountView user={user} />}
            {page === 'assets' && <AssetsList listColors={ROWS} onOpen={(id) => onShow(`asset-${id}`)} onAdd={() => onShow('add-asset')} />}
            {page === 'add-asset' && <AddAssetForm listColors={ROWS} onAdded={(id) => onShow(`asset-${id}`)} />}
            {assetId !== undefined && <AssetEditor id={assetId} listColors={ROWS} onRemoved={() => onShow('assets')} />}
          </div>
        </div>
      </section>
    </>
  )
}

type MainProps = Pick<Props, 'user' | 'attribution' | 'onShow'> & { assetCount: number }

function MainView({ user, assetCount, attribution, onShow }: MainProps) {
  const now = useNow(30_000)
  const [links] = useLiveLinks(now)

  return (
    <>
      <div className="flex flex-col items-center px-4 text-center">
        <Initial name={user.name} className="size-24 text-4xl" />
        <h2 className="mt-3 text-2xl font-bold">{user.name}</h2>
        {user.email && user.email !== user.name && <p className="opacity-60">{user.email}</p>}
      </div>
      <List strong inset className="mb-4! mt-6!" colors={ROWS}>
        <ListItem
          link
          title="Assets"
          media={<RowIcon className="bg-[#af52de]" icon={<ListIcon />} />}
          after={String(assetCount)}
          onClick={() => onShow('assets')}
        />
        <ListItem
          link
          title="Appearance"
          media={<RowIcon className="bg-[#007aff]" icon={<AppearanceIcon />} />}
          onClick={() => onShow('appearance')}
        />
        <ListItem
          link
          title="Live links"
          media={<RowIcon className="bg-[#34c759]" icon={<LiveIcon />} />}
          after={links.length ? String(links.length) : 'None'}
          onClick={() => onShow('live-links')}
        />
        <ListItem
          link
          title="Account"
          media={<RowIcon className="bg-[#8e8e93]" icon={<PersonIcon />} />}
          onClick={() => onShow('account')}
        />
      </List>
      {/* The map data's credits, which the licence requires: here rather than on the map. */}
      {attribution.length > 0 && (
        <p className="px-8 pb-4 text-center text-xs opacity-60">
          {attribution.map((html, index) => (
            <span key={html}>
              {index > 0 && ' · '}
              {creditParts(html)}
            </span>
          ))}
        </p>
      )}
    </>
  )
}

/** Who's signed in, and Sign out. */
function AccountView({ user }: { user: SessionUser }) {
  const router = useRouter()

  async function signOut() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  return (
    <>
      <List strong inset colors={ROWS}>
        <ListItem title="Name" after={user.name} />
        {user.email && <ListItem title="Email" after={user.email} />}
      </List>
      <BlockFooter>Your Traccar account. Change it in Traccar.</BlockFooter>
      <List strong inset colors={ROWS}>
        <ListButton colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }} onClick={() => void signOut()}>
          Sign out
        </ListButton>
      </List>
    </>
  )
}

/**
 * A map source's credit as text and links. It's HTML from the map style, so it isn't inserted as
 * HTML: only its text, and its links when they're http(s), as new-tab links.
 */
function creditParts(html: string): ReactNode[] {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return [...body.childNodes].map((node, index) =>
    node instanceof HTMLAnchorElement && /^https?:/.test(node.href) ? (
      <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="underline">
        {node.textContent}
      </a>
    ) : (
      node.textContent
    ),
  )
}

/** The user's initial in an accent-coloured circle; Traccar users have no picture. */
function Initial({ name, className }: { name: string; className: string }) {
  return (
    <span className={`grid place-items-center rounded-full bg-primary font-semibold text-white ${className}`} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** A row's icon: white on a coloured circle, as in Apple Maps' profile card. */
function RowIcon({ className, icon }: { className: string; icon: ReactNode }) {
  return <span className={`grid size-9 place-items-center rounded-full text-white ${className}`}>{icon}</span>
}

function ListIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="5" cy="6.5" r="1.6" />
        <circle cx="5" cy="12" r="1.6" />
        <circle cx="5" cy="17.5" r="1.6" />
      </g>
      <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/** A circle, half filled: light and dark, as in iOS's appearance settings. */
function AppearanceIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  )
}

/** The location arrow: an outline while off, filled while your position shows. */
function LocationIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="size-6" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.5 3.5 3.8 10.6c-.8.3-.7 1.5.1 1.7l6.4 1.4 1.4 6.4c.2.8 1.4.9 1.7.1Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A head and shoulders. */
function PersonIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20.5c.8-4 4-6.2 8-6.2s7.2 2.2 8 6.2Z" fill="currentColor" />
    </svg>
  )
}

/** A dot with waves either side: broadcasting a position. */
function LiveIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <path
        d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
