import type { Ref } from 'react'
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

/** The round ✕ in a card's corner. */
export function CloseButton({ ref, className = '', onClick }: { ref?: Ref<HTMLButtonElement>; className?: string; onClick: () => void }) {
  return (
    <button
      ref={ref}
      type="button"
      className={`fixed-size grid size-11 shrink-0 place-items-center rounded-full bg-black/5 active:opacity-60 dark:bg-white/10 ${className}`}
      aria-label="Close"
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  )
}

/**
 * The full-height class of a second-level card: from just below the status bar to the bottom of the
 * screen, over the card it came from, sliding up from below while it opens.
 */
export function pageCardClass(open: boolean): string {
  return `absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+8px)] z-60 mx-auto max-w-xl px-2 transition-transform duration-300 ease-out ${open ? '' : 'translate-y-[calc(100%+16px)]'}`
}
