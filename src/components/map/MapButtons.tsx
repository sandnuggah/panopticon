import type { MapLibreMap } from 'maplibre-gl'
import { LocationIcon, MinusIcon, PlusIcon } from '../icons'

type Props = {
  map: { current: MapLibreMap | null }
  /**
   * `above-bar`: zoom only, just above the bottom bar's Settings button and as wide as it (the map screen, where your
   * position is the bar's button). `top-right`: your position and zoom, under the status bar (live
   * link pages, which have a panel instead of the bar).
   */
  placement: 'above-bar' | 'top-right'
  showMe: boolean
  onToggleMe: () => void
}

/** The map's buttons, as a pill like the bottom bar (BottomBar.tsx): the same colours, shadow and line icons. */
export function MapButtons({ map, placement, showMe, onToggleMe }: Props) {
  // Above the bar, as wide as the Settings button below it (64 px), so their edges line up.
  const button = `grid place-items-center active:opacity-50 ${placement === 'above-bar' ? 'h-14 w-16 [&>svg]:size-7' : 'size-11'}`
  const divider = <span className="h-px w-6 bg-black/10 dark:bg-white/15" aria-hidden="true" />
  const pill = (
    <div className="pointer-events-auto flex flex-col items-center rounded-full shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2">
      {placement === 'top-right' && (
        <>
          <button
            type="button"
            className={`${button} ${showMe ? 'text-primary' : ''}`}
            aria-label={showMe ? 'Hide my position' : 'Show my position'}
            aria-pressed={showMe}
            onClick={onToggleMe}
          >
            <LocationIcon filled={showMe} />
          </button>
          {divider}
        </>
      )}
      <button type="button" className={button} aria-label="Zoom in" onClick={() => map.current?.zoomIn(undefined, { byHand: true })}>
        <PlusIcon />
      </button>
      {divider}
      <button type="button" className={button} aria-label="Zoom out" onClick={() => map.current?.zoomOut(undefined, { byHand: true })}>
        <MinusIcon />
      </button>
    </div>
  )
  if (placement === 'top-right') {
    return <div className="fixed-size pointer-events-none absolute right-3 top-[calc(env(safe-area-inset-top)+12px)] z-[5]">{pill}</div>
  }
  return (
    <div className="fixed-size pointer-events-none absolute inset-x-0 bottom-[calc(max(12px,env(safe-area-inset-bottom))+76px)] z-[5] px-3">
      <div className="mx-auto flex max-w-xl justify-end lg:max-w-none">{pill}</div>
    </div>
  )
}
