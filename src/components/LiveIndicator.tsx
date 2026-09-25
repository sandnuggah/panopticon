import type { LiveStatus } from '../lib/useLiveAssets'

const labels: Record<LiveStatus, string> = {
  live: 'Live',
  connecting: 'Connecting…',
  offline: 'Offline, retrying',
}

/** Shows whether positions are arriving live, so a still map isn't mistaken for a still asset. */
export function LiveIndicator({ status }: { status: LiveStatus }) {
  return (
    <span className={`live-indicator live-${status}`} role="status">
      <span className="live-dot" aria-hidden="true" />
      {labels[status]}
    </span>
  )
}
