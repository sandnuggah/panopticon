import { useCallback, useSyncExternalStore } from 'react'

// Per-browser preferences in localStorage. They're conveniences: if storage is unavailable
// (private mode, blocked site data) the defaults apply and nothing breaks. Only what was chosen is
// stored, so a changed default reaches browsers that never chose. The trail's length, paw prints and
// Snap to paths were stored here too until they became each asset's own (see TrailOptions in
// trail.ts, stored in Traccar); what's left of them here is ignored.

export type Settings = {
  /** The map style's id, or Auto (see mapStyles.ts); unset means the server's default. */
  mapStyle?: string
}

const STORAGE_KEY = 'panopticon.settings'
const DEFAULTS: Settings = {}
const VERSION = 2

type Stored = Partial<Settings> & { v?: number }

/** What this browser chose. */
function storedChoices(raw: string | null): Stored {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value !== 'object' || value === null) return {}
    return typeof value.mapStyle === 'string' ? { mapStyle: value.mapStyle } : {}
  } catch {
    return {}
  }
}

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
  return storedChoices(raw)
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
      const chosen = storedChoices(localStorage.getItem(STORAGE_KEY))
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...chosen, ...patch, v: VERSION }))
    } catch {
      // Storage unavailable; the change only lasts until the page reloads.
      cachedSettings = { ...cachedSettings, ...patch }
    }
    for (const listener of listeners) listener()
  }, [])
  return [settings, update, loaded]
}
