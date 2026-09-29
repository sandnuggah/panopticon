import type { LocationShare } from './share'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Opens the system share sheet (Messages, WhatsApp, mail…). Browsers without one, like desktop
 * Firefox, copy the message instead. Safari only opens it straight after a tap, so a share after a
 * slow request can fail; that's 'failed', and the caller offers another tap.
 */
export async function shareOrCopy(message: LocationShare): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share(message)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      if (error instanceof DOMException && error.name === 'NotAllowedError') return 'failed'
      // Anything else falls back to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(`${message.text} ${message.url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}
