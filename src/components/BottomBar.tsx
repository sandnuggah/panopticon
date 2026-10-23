import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Asset } from '../lib/asset'
import { isGrey, type AssetStatus } from '../lib/status'
import { AssetAvatar } from './AssetAvatar'
import { LocationIcon } from './icons'
import { UserInitial } from './UserInitial'

type Props = {
  /** The signed-in user, whose initial is the Settings button. */
  userName: string
  /** The assets on the map, each as its picture, greyed out when lost (see status.ts). */
  assets: Asset[]
  statuses: Record<number, AssetStatus>
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
 * The bars floating at the bottom of the map, like Apple Maps': one with your position on and off
 * and each asset's picture, as wide as they need (scrolling sideways when there are too many), and
 * at the right, on its own, the Settings button (your initial), which opens the Settings card
 * (SettingsCard.tsx). One size whatever the text size, as iOS's bars are.
 */
export function BottomBar({
  userName,
  assets,
  statuses,
  selectedId,
  onAssetTap,
  showMe,
  onToggleMe,
  settingsOpen,
  onOpenSettings,
  settingsButton,
}: Props) {
  const { scroller, fadeStyle } = useEdgeFade(assets.length)
  const surface =
    'shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2'
  return (
    <div className="bottom-bar fixed-size absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-2 lg:max-w-none">
        <div className={`flex h-16 min-w-0 items-center rounded-full px-2 ${surface}`}>
          <button
            type="button"
            className={`grid size-12 shrink-0 place-items-center rounded-full active:opacity-60 [&>svg]:size-7 ${showMe ? 'text-primary' : ''}`}
            aria-label={showMe ? 'Hide my position' : 'Show my position'}
            aria-pressed={showMe}
            onClick={onToggleMe}
          >
            <LocationIcon filled={showMe} />
          </button>
          {/* Each asset's picture: the first tap centres it on the map, the next opens its details.
              They scroll sideways when they don't fit, your position staying put. */}
          <div
            ref={scroller}
            className="flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={fadeStyle}
          >
            {assets.map((asset) => {
              const selected = asset.id === selectedId
              return (
                <button
                  key={asset.id}
                  type="button"
                  className="shrink-0 rounded-full active:opacity-60"
                  aria-label={selected ? `${asset.name}: details` : `Show ${asset.name}`}
                  onClick={() => onAssetTap(asset.id)}
                >
                  <AssetAvatar asset={asset} size="bar" stale={!!statuses[asset.id] && isGrey(statuses[asset.id]!)} />
                </button>
              )
            })}
          </div>
        </div>
        <button
          ref={settingsButton}
          type="button"
          className={`grid size-16 shrink-0 place-items-center rounded-full active:opacity-60 ${surface}`}
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onOpenSettings}
        >
          <UserInitial name={userName} className="size-12 text-xl" />
        </button>
      </div>
    </div>
  )
}

/** How far the pictures fade out at an edge with more of them past it. */
const FADE_PX = 28

/**
 * Fades a sideways-scrolling row out to transparent at each edge that has more past it, so it's
 * clear there's more to scroll to, and not at an edge it's scrolled all the way to.
 */
function useEdgeFade(count: number) {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const update = () => {
      const max = element.scrollWidth - element.clientWidth
      const start = element.scrollLeft > 1
      const end = element.scrollLeft < max - 1
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [count])

  let fadeStyle: CSSProperties | undefined
  if (edges.start || edges.end) {
    const mask = `linear-gradient(to right, ${edges.start ? 'transparent' : '#000'}, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), ${edges.end ? 'transparent' : '#000'})`
    fadeStyle = { maskImage: mask, WebkitMaskImage: mask }
  }
  return { scroller, fadeStyle }
}
