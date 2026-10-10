import type { MapLibreMap } from 'maplibre-gl'
import { MinusIcon, PlusIcon } from '../icons'

/**
 * Zoom in and out, as a pill like the bottom bar (BottomBar.tsx): the same colours, shadow and
 * line icons, at its right end, just above it.
 */
export function ZoomButtons({ map }: { map: { current: MapLibreMap | null } }) {
  const button = 'grid size-11 place-items-center active:opacity-50'
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(max(12px,env(safe-area-inset-bottom))+68px)] z-[5] px-3">
      <div className="mx-auto flex max-w-xl justify-end">
        <div className="pointer-events-auto flex flex-col items-center rounded-full shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2">
          <button type="button" className={button} aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
            <PlusIcon />
          </button>
          <span className="h-px w-6 bg-black/10 dark:bg-white/15" aria-hidden="true" />
          <button type="button" className={button} aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
            <MinusIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
