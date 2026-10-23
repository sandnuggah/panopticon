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

/** A bell: alerts. */
export function BellIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.5c-.4.7.1 1.5.9 1.5h13.4c.8 0 1.3-.8.9-1.5L18 12.6V9a6 6 0 0 0-6-6Z" fill="currentColor" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** A paw print: trails and walks. */
export function PawIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        <ellipse cx="12" cy="15.5" rx="5" ry="4.5" />
        <ellipse cx="5.5" cy="10" rx="2.2" ry="2.8" />
        <ellipse cx="9.5" cy="5.5" rx="2.2" ry="2.8" />
        <ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8" />
        <ellipse cx="18.5" cy="10" rx="2.2" ry="2.8" />
      </g>
    </svg>
  )
}

/** A padlock: private, on your own server. */
export function LockIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="5" y="10" width="14" height="10.5" rx="2.5" fill="currentColor" />
    </svg>
  )
}

/** An arrow going in through a door: arrived at a place. */
export function ArrivedIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14M3.5 12H14M10 8l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A winding route between two points: out, away from its places. */
export function OutIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="18.5" r="2.5" fill="currentColor" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" />
      <path
        d="M8.5 18.5H15a3.25 3.25 0 0 0 0-6.5H9a3.25 3.25 0 0 1 0-6.5h6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** A map pin: places. */
export function PinIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21.5s-6.5-6.2-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11.5-6.5 11.5ZM12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z"
        fill="currentColor"
        fillRule="evenodd"
      />
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
/** Three bars, for Stats. */
export function StatsIcon() {
  return (
    <svg className="mr-1.5 size-4" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 14V9M8 14V3M13 14V6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function ShareIcon({ className = 'mr-1.5 size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
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
