import { useCallback, useSyncExternalStore } from 'react'
import { TRAIL_MINUTES_OPTIONS } from './trail'

// Per-browser preferences in localStorage. They're conveniences: if storage is unavailable
// (private mode, blocked site data) the defaults apply and nothing breaks.

export type Settings = {
  /** How many minutes of movement to draw behind each asset. 0 = no trail. */
  trailMinutes: number
}

const STORAGE_KEY = 'panopticon.settings'
const DEFAULTS: Settings = { trailMinutes: 10 }

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cachedSettings: Settings = DEFAULTS

function read(): Settings {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return cachedSettings
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedSettings = parse(raw)
  }
  return cachedSettings
}

function parse(raw: string | null): Settings {
  if (!raw) return DEFAULTS
  try {
    const value = JSON.parse(raw) as Partial<Settings>
    const trailMinutes = (TRAIL_MINUTES_OPTIONS as readonly number[]).includes(value.trailMinutes as number)
      ? (value.trailMinutes as number)
      : DEFAULTS.trailMinutes
    return { trailMinutes }
  } catch {
    return DEFAULTS
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Keeps other tabs in sync.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const noSubscription = () => () => {}

/**
 * Returns the settings, a setter, and whether the stored values have been read yet. The server
 * render and hydration see the defaults; wait for `loaded` before acting on a value (e.g. fetching).
 */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS)
  const loaded = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  )
  const update = useCallback((patch: Partial<Settings>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }))
    } catch {
      // Storage unavailable; the change only lasts until the page reloads.
      cachedSettings = { ...cachedSettings, ...patch }
    }
    for (const listener of listeners) listener()
  }, [])
  return [settings, update, loaded]
}
