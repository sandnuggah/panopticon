import type { LiveStatus } from '../lib/useLiveAssets'

const labels: Record<LiveStatus, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline, retrying',
}

/**
 * Shows whether positions are arriving live, so a still map isn't mistaken for a still asset. A pill
 * like the bottom bar and the zoom buttons: the same colours and shadow.
 */
export function LiveIndicator({ status }: { status: LiveStatus }) {
  return (
    <span
      className={`live-${status} inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.9375em] font-medium shadow-lg ios:bg-ios-light-surface-1 ios:dark:bg-ios-dark-surface-1 material:bg-md-light-surface-2 material:dark:bg-md-dark-surface-2`}
      role="status"
    >
      <span className="live-dot" aria-hidden="true" />
      {labels[status]}
    </span>
  )
}
