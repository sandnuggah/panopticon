import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_TRAIL, nearestTrail, type TrailLength } from './trail'

// Per-browser preferences in localStorage. They're conveniences: if storage is unavailable
// (private mode, blocked site data) the defaults apply and nothing breaks.

export type Settings = {
  /** How much movement to draw behind each asset. */
  trail: TrailLength
  /** Snap walks on the trail to streets and paths, when the server offers it. */
  snapToPaths: boolean
  /** Draw walks as paw prints instead of a line. */
  pawPrints: boolean
  /** The map style's id, or Auto (see mapStyles.ts); unset means the server's default. */
  mapStyle?: string
}

const STORAGE_KEY = 'panopticon.settings'
const DEFAULTS: Settings = { trail: DEFAULT_TRAIL, snapToPaths: false, pawPrints: false }

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
    // `trailMinutes` is what the trail length was saved as before "today" existed.
    const value = JSON.parse(raw) as Partial<Settings> & { trailMinutes?: unknown; followRoads?: unknown }
    const trail = nearestTrail(value.trail ?? value.trailMinutes) ?? DEFAULTS.trail
    // `followRoads` is what Snap to paths was saved as before it was renamed.
    const snapToPaths = typeof value.snapToPaths === 'boolean' ? value.snapToPaths : value.followRoads === true
    const settings: Settings = { trail, snapToPaths, pawPrints: value.pawPrints === true }
    if (typeof value.mapStyle === 'string') settings.mapStyle = value.mapStyle
    return settings
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
