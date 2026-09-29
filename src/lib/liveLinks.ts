import { useCallback, useSyncExternalStore } from 'react'

// The live location links made in this browser, so they can be sent again or stopped. panopticon
// stores nothing on the server, so other browsers don't see them; a link keeps working until it
// expires either way. Kept in localStorage, and dropped once expired.

export type LiveLink = { link: string; assetId: number; expiresAt: number }

const STORAGE_KEY = 'panopticon.liveLinks'
const listeners = new Set<() => void>()
const none: LiveLink[] = []
let cachedRaw: string | null | undefined
let cached: LiveLink[] = none

function read(): LiveLink[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return cached
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cached = parse(raw)
  }
  return cached
}

function parse(raw: string | null): LiveLink[] {
  if (!raw) return none
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return none
    return value.filter(
      (item): item is LiveLink =>
        typeof item?.link === 'string' && Number.isInteger(item?.assetId) && Number.isFinite(item?.expiresAt),
    )
  } catch {
    return none
  }
}

function write(links: LiveLink[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links))
  } catch {
    // Storage unavailable: the list only lasts until the page reloads.
    cached = links
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/** This asset's live links that haven't expired, soonest to expire first, plus add and remove. */
export function useLiveLinks(
  assetId: number,
  now: number,
): [LiveLink[], (link: LiveLink) => void, (link: string) => void] {
  const all = useSyncExternalStore(subscribe, read, () => none)
  const links = all
    .filter((link) => link.assetId === assetId && link.expiresAt > now)
    .sort((a, b) => a.expiresAt - b.expiresAt)
  const add = useCallback((link: LiveLink) => {
    write([...read().filter((other) => other.expiresAt > Date.now()), link])
  }, [])
  const remove = useCallback((link: string) => {
    write(read().filter((other) => other.link !== link && other.expiresAt > Date.now()))
  }, [])
  return [links, add, remove]
}
