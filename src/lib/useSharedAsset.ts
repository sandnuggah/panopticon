import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { Asset } from './asset'
import { applyUpdates, type LiveUpdate } from './live'
import type { LiveStatus } from './useLiveAssets'

/**
 * Keeps a live location link's asset current from /s/<link>/live. When the stream ends for good
 * (the link expired or was stopped) or the expiry passes, the page reloads its data, which then
 * says why.
 */
export function useSharedAsset(initial: Asset, link: string, expiresAt: number): { asset: Asset; status: LiveStatus } {
  const router = useRouter()
  const [asset, setAsset] = useState(initial)
  const assetRef = useRef(initial)
  const [status, setStatus] = useState<LiveStatus>('connecting')

  useEffect(() => {
    assetRef.current = initial
    setAsset(initial)
  }, [initial])

  useEffect(() => {
    let source: EventSource | undefined
    const reload = () => void router.invalidate()

    const connect = () => {
      source?.close()
      setStatus('connecting')
      source = new EventSource(`/s/${link}/live`)
      source.onopen = () => setStatus('live')
      source.onmessage = (event) => {
        try {
          const updates = JSON.parse(event.data) as LiveUpdate[]
          const next = applyUpdates([assetRef.current], updates).assets[0]
          if (next) {
            assetRef.current = next
            setAsset(next)
          }
        } catch (error) {
          console.warn('Ignoring live message:', error)
        }
      }
      source.addEventListener('ended', () => {
        source?.close()
        reload()
      })
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) {
          setStatus('connecting')
          return
        }
        // Refused: the link may have ended; the reloaded data says.
        setStatus('offline')
        reload()
      }
    }

    // Phones suspend background tabs; catch up when the page is visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      reload()
      connect()
    }

    const expiry = setTimeout(reload, Math.max(0, expiresAt - Date.now()) + 1_000)
    connect()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearTimeout(expiry)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      source?.close()
    }
  }, [link, expiresAt, router])

  return { asset, status }
}
