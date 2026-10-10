import { useEffect } from 'react'
import { formatTime } from '../lib/share'

/** How long a banner stays before it goes by itself. */
const SHOWN_MS = 8_000

type Props = {
  /** "Betty left Home", and when; null while there's nothing to say. `key` changes for every new banner. */
  banner: { text: string; time: string; key: number } | null
  /** Tapping it: shows the asset. */
  onTap: () => void
  onDone: () => void
}

/**
 * Says when an asset arrives at or leaves a place, while the app is open, at the top of the map like
 * an iOS banner. Read out by screen readers. Not a notification: the app has to be open.
 */
export function PlaceBanner({ banner, onTap, onDone }: Props) {
  useEffect(() => {
    if (!banner) return
    const timer = setTimeout(onDone, SHOWN_MS)
    return () => clearTimeout(timer)
  }, [banner?.key])

  return (
    <div className="place-banner-area" role="status" aria-live="polite">
      {banner && (
        <button key={banner.key} type="button" className="place-banner" onClick={onTap}>
          <span className="font-semibold">{banner.text}</span>
          <span className="opacity-60"> · {formatTime(Date.parse(banner.time), Date.now())}</span>
        </button>
      )}
    </div>
  )
}
