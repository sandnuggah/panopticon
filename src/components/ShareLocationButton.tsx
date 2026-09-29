import { useState } from 'react'
import type { Asset } from '../lib/asset'
import { locationShare } from '../lib/share'

type Props = { asset: Asset; address: string | undefined }

/**
 * Shares where the asset is through the system share sheet (Messages, WhatsApp, mail…). Browsers
 * without one, like desktop Firefox, copy the message instead. Nothing to share without a location.
 */
export function ShareLocationButton({ asset, address }: Props) {
  const [result, setResult] = useState<'copied' | 'failed'>()
  const location = asset.location
  if (!location) return null

  async function share() {
    const message = locationShare(asset.name, location!, address, Date.now())
    if (navigator.share) {
      try {
        await navigator.share(message)
        return
      } catch (error) {
        // Closing the share sheet isn't a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(`${message.text} ${message.url}`)
      show('copied')
    } catch {
      show('failed')
    }
  }

  function show(next: 'copied' | 'failed') {
    setResult(next)
    setTimeout(() => setResult(undefined), 2_500)
  }

  return (
    <button type="button" className="button-share" onClick={() => void share()}>
      <ShareIcon />
      {/* Announced when it changes, so the fallback is heard as well as seen. */}
      <span aria-live="polite">
        {result === 'copied' ? 'Copied to clipboard' : result === 'failed' ? "Couldn't share" : 'Share location'}
      </span>
    </button>
  )
}

/** A box with an arrow out of it, the usual share symbol. Decorative; the label says it. */
function ShareIcon() {
  return (
    <svg className="share-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10V1.75M5 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 6.75H4.25a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
