import { useLayoutEffect, type Ref, type RefObject } from 'react'
import { CloseIcon } from './icons'

// The pieces the map screen's cards share (SettingsCard, AssetDetailsCard, Share), so they look alike.

/** A card's background: Konsta's grouped-list surface, a step darker than its rows in dark mode. */
export const CARD_BG = 'ios:bg-ios-light-surface ios:dark:bg-[#1c1c1e] material:bg-md-light-surface-1 material:dark:bg-md-dark-surface-1'

/** In dark mode a card's rows are a step lighter than the card, as in Apple Maps. */
export const ROWS = { strongBgIos: 'bg-ios-light-surface-1 dark:bg-[#2c2c2e]' }

/** Dims what's under a card; tapping it closes the card. */
export function Backdrop({ shown, z, onClick }: { shown: boolean; z: string; onClick: () => void }) {
  return (
    <div
      className={`absolute inset-0 ${z} bg-black/25 transition-opacity duration-300 ${shown ? '' : 'pointer-events-none opacity-0'}`}
      aria-hidden="true"
      onClick={onClick}
    />
  )
}

/**
 * Moves focus as a card opens or closes. preventScroll: without it the browser scrolls the map
 * screen to bring the element into view while a card is still sliding, and the whole screen jumps.
 * focusVisible: false: a tap moved it, so no focus ring; Safari otherwise draws one around ✕.
 */
export function moveFocus(element: HTMLElement | null | undefined) {
  element?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
}

/** The round ✕ in a card's corner. */
export function CloseButton({ ref, className = '', onClick }: { ref?: Ref<HTMLButtonElement>; className?: string; onClick: () => void }) {
  return (
    <button
      ref={ref}
      type="button"
      className={`grid size-11 shrink-0 place-items-center rounded-full bg-black/5 active:opacity-60 dark:bg-white/10 ${className}`}
      aria-label="Close"
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  )
}

/**
 * On a wide screen (lg, 1024 px and up) the cards are side panels instead of sheets from the bottom,
 * like Apple Maps' sidebar on a Mac: 380 px wide, from below the Live pill and the update notice
 * down to above the bottom bar, on the side of what opened them: an asset's cards on the left (its
 * picture is at the bottom left), Settings' on the right (its button is at the bottom right).
 */
export type Side = 'left' | 'right'

/** Where a card goes on a wide screen; `fill`: down to above the bottom bar, else as tall as its content. */
export function sidePanel(side: Side, fill = false): string {
  return `lg:inset-x-auto lg:top-[calc(env(safe-area-inset-top)+60px)] lg:mx-0 lg:w-[380px] lg:max-w-none lg:px-0 lg:pb-0 ${
    fill ? 'lg:bottom-[100px]' : 'lg:bottom-auto'
  } ${side === 'left' ? 'lg:left-3 lg:right-auto' : 'lg:right-3 lg:left-auto'}`
}

/** A side panel's card slides in from its side instead of from below. */
export function sidePanelClosed(side: Side): string {
  return `lg:translate-y-0 ${side === 'left' ? 'lg:-translate-x-[calc(100%+24px)]' : 'lg:translate-x-[calc(100%+24px)]'}`
}

/** The tallest a content-height card gets in a side panel: down to above the bottom bar. */
export const SIDE_PANEL_MAX_HEIGHT = 'lg:max-h-[calc(100dvh-env(safe-area-inset-top)-160px)]'

/**
 * For a right-hand panel that leaves the map usable (the place editor): down to above the zoom
 * buttons, which sit above Settings at the bottom right.
 */
export const SIDE_PANEL_ABOVE_ZOOM = 'lg:max-h-[calc(100dvh-env(safe-area-inset-top)-284px)]'

/**
 * The full-height class of a second-level card: from just below the status bar to the bottom of the
 * screen, over the card it came from, sliding up from below while it opens. On a wide screen, a
 * full-height side panel over the card it came from.
 */
export function pageCardClass(open: boolean, side: Side = 'right'): string {
  return `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+8px)] z-60 mx-auto max-w-xl px-2 transition-transform duration-300 ease-out ${sidePanel(side, true)} ${open ? '' : `translate-y-[calc(100%+16px)] ${sidePanelClosed(side)}`}`
}

/** How much of the map a card covers, in pixels from each edge, so the map centres what's left (AssetMap). */
export type Cover = { top: number; right: number; bottom: number; left: number }

export const NO_COVER: Cover = { top: 0, right: 0, bottom: 0, left: 0 }

export function sameCover(a: Cover, b: Cover): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

/**
 * Reports what a card covers of the map while it's open, and no cover once it closes: the bottom
 * on a phone, its side on a wide screen (lg), where it's a side panel. Measured from where the card
 * sits when open, not where it is mid-slide, so the map can move along with it; kept up to date as
 * its height changes (text loading, Dynamic Type). `wideOnly`: a card that covers the map on a
 * phone only as a modal (Settings) counts only as a side panel. `panel: false`: a card that stays
 * at the bottom on a wide screen too (the live link page's).
 */
export function useCover(
  card: RefObject<HTMLElement | null>,
  open: boolean,
  onCover: (cover: Cover) => void,
  { wideOnly = false, panel = true } = {},
) {
  useLayoutEffect(() => {
    const element = card.current
    const screen = element?.offsetParent
    if (!element || !(screen instanceof HTMLElement) || !open) return onCover(NO_COVER)
    const report = () => {
      const side = panel && window.matchMedia('(min-width: 1024px)').matches
      // offsetTop and offsetLeft leave out the slide's transform.
      if (!side) return onCover(wideOnly ? NO_COVER : { ...NO_COVER, bottom: screen.clientHeight - element.offsetTop })
      const onLeft = element.offsetLeft + element.offsetWidth / 2 < screen.clientWidth / 2
      onCover(
        onLeft
          ? { ...NO_COVER, left: element.offsetLeft + element.offsetWidth }
          : { ...NO_COVER, right: screen.clientWidth - element.offsetLeft },
      )
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [card, open, onCover, wideOnly, panel])
}
