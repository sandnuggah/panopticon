import type { RefObject } from 'react'
import { isStale, type Asset } from '../lib/asset'
import { useNow } from '../lib/useNow'
import { AssetAvatar } from './AssetAvatar'
import { LocationIcon } from './icons'
import { UserInitial } from './UserInitial'

type Props = {
  /** The signed-in user, whose initial is the Settings button. */
  userName: string
  /** The assets on the map, each as its picture. */
  assets: Asset[]
  selectedId: number | undefined
  /** A picture was tapped: select and centre that asset, or, when it's selected, show its details. */
  onAssetTap: (id: number) => void
  /** Whether your own position shows on the map, and the button that turns it on and off. */
  showMe: boolean
  onToggleMe: () => void
  /** Whether the Settings card is open, and the button that opens it. */
  settingsOpen: boolean
  onOpenSettings: () => void
  settingsButton: RefObject<HTMLButtonElement | null>
}

/**
 * The bar floating at the bottom of the map, like Apple Maps' search bar: your position on and off
 * at its left end, each asset's picture, and the Settings button (your initial) at its right, which
 * opens the Settings card (SettingsCard.tsx).
 */
export function BottomBar({
  userName,
  assets,
  selectedId,
  onAssetTap,
  showMe,
  onToggleMe,
  settingsOpen,
  onOpenSettings,
  settingsButton,
}: Props) {
  const now = useNow(30_000)
  return (
    <div className="bottom-bar fixed-size absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
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
          ref={settingsButton}
          type="button"
          className="rounded-full active:opacity-60"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onOpenSettings}
        >
          <UserInitial name={userName} className="size-11 text-lg" />
        </button>
      </div>
    </div>
  )
}
