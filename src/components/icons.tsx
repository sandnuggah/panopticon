// The app's small line icons, drawn in code like iOS's SF Symbols: `currentColor`, so they take the
// colour of their button or row. Decorative unless noted; the button or row label says what they mean.

/** A bulleted list: the assets, one per row. */
export function ListIcon() {
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
export function AppearanceIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  )
}

/** The location arrow: an outline while off, filled while your position shows. */
export function LocationIcon({ filled }: { filled: boolean }) {
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
export function PersonIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20.5c.8-4 4-6.2 8-6.2s7.2 2.2 8 6.2Z" fill="currentColor" />
    </svg>
  )
}

/** A dot with waves either side: broadcasting a position. */
export function LiveIcon() {
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

/** A box with an arrow out of it, the usual share symbol. */
export function ShareIcon() {
  return (
    <svg className="mr-1.5 size-4" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10V1.75M5 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M5.5 6.75H4.25a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** The back chevron, as in "‹ Assets". */
export function BackIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The ✕ of a card's close button. */
export function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/** A checkmark for the chosen row of a list. Labelled "Selected", since it's the only sign of it. */
export function CheckIcon() {
  return (
    <svg className="size-5 text-primary" viewBox="0 0 20 20" aria-label="Selected" role="img">
      <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Zoom in. */
export function PlusIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

/** Zoom out. */
export function MinusIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}
