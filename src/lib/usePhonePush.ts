import { useCallback, useEffect, useState } from 'react'
import type { PushTarget } from '../server/webPush.server'

// This phone's push subscription, for alerts (see AssetAlerts.tsx): whether it can have one, and
// turning it on and off. The service worker (public/sw.js) only shows the notifications.

export type PhonePush =
  | { kind: 'checking' }
  /** No push in this browser. */
  | { kind: 'unsupported' }
  /** iPhone or iPad in Safari: push only works in the Home Screen app. */
  | { kind: 'install' }
  /** Notifications turned off for the app. */
  | { kind: 'denied' }
  | { kind: 'off' }
  | { kind: 'on'; target: PushTarget }

export function usePhonePush() {
  const [state, setState] = useState<PhonePush>({ kind: 'checking' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await check()
      if (!cancelled) setState(next)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Asks to send notifications (call it from a tap: browsers only ask then), and subscribes. */
  const turnOn = useCallback(async (vapidPublicKey: string): Promise<PushTarget | null> => {
    const registration = await navigator.serviceWorker.ready
    try {
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(atob(vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      })
      const target = toTarget(subscription)
      setState(target ? { kind: 'on', target } : { kind: 'unsupported' })
      return target
    } catch {
      setState(Notification.permission === 'denied' ? { kind: 'denied' } : { kind: 'off' })
      return null
    }
  }, [])

  const turnOff = useCallback(async () => {
    const registration = await navigator.serviceWorker.ready
    await (await registration.pushManager.getSubscription())?.unsubscribe()
    setState({ kind: 'off' })
  }, [])

  return { state, turnOn, turnOff }
}

/**
 * This phone's push endpoint if it has alerts on, without asking or registering anything: null
 * without a service worker or a subscription, or when the browser doesn't answer (see check).
 */
export async function alertsEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  try {
    const registration = await withinSeconds(10, navigator.serviceWorker.getRegistration())
    const subscription = registration && (await withinSeconds(10, registration.pushManager.getSubscription()))
    return subscription?.endpoint ?? null
  } catch {
    return null
  }
}

async function check(): Promise<PhonePush> {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return apple && !standalone ? { kind: 'install' } : { kind: 'unsupported' }
  }
  if (Notification.permission === 'denied') return { kind: 'denied' }
  try {
    await navigator.serviceWorker.register('/sw.js')
    // Safari only answers once the worker is active; and where push isn't there after all (the
    // iOS Simulator), it never answers.
    const subscription = await withinSeconds(
      10,
      navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()),
    )
    const target = subscription && toTarget(subscription)
    return target ? { kind: 'on', target } : { kind: 'off' }
  } catch {
    return { kind: 'unsupported' }
  }
}

function withinSeconds<T>(seconds: number, promise: Promise<T>): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), seconds * 1000))])
}

function toTarget(subscription: PushSubscription): PushTarget | null {
  const { endpoint, keys } = subscription.toJSON()
  return endpoint && keys?.p256dh && keys.auth ? { endpoint, p256dh: keys.p256dh, auth: keys.auth } : null
}
