import { useCallback, useSyncExternalStore } from 'react'
import { useRouteContext } from '@tanstack/react-router'

// Themes are chosen per browser and kept in a cookie (not localStorage) so the server can render
// the right one straight away, without a flash of the default theme. Colours live in styles.css,
// keyed on <html data-theme>.

export const THEMES = [
  {
    id: 'classic',
    label: 'Classic',
    /** The app's name as this theme shows it (login title, browser tab). */
    appName: 'Panopticon',
    description: 'Calm greens. Follows your device’s light or dark mode.',
  },
  {
    id: 'pet',
    label: 'Petopticon',
    appName: 'Petopticon',
    description: 'Bright pastels, rounder shapes, and paw prints for trails. Follows your device’s light or dark mode.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'classic'
export const THEME_COOKIE = 'panopticon-theme'

/** Ids that were renamed, so browsers that saved the old one keep their theme. */
const RENAMED_THEMES: Record<string, ThemeId> = { dog: 'pet' }

export function parseTheme(value: string | undefined | null): ThemeId {
  const id = (value && RENAMED_THEMES[value]) || value
  return THEMES.some((theme) => theme.id === id) ? (id as ThemeId) : DEFAULT_THEME
}

/** The app's name in the given theme, e.g. "Petopticon" in the pet theme. */
export function appName(theme: ThemeId): string {
  return THEMES.find((option) => option.id === theme)?.appName ?? 'Panopticon'
}

export function themeFromCookieHeader(cookieHeader: string): ThemeId {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookieHeader)
  return parseTheme(match?.[1])
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readBrowserTheme(): ThemeId {
  return themeFromCookieHeader(document.cookie)
}

/** The current theme and a setter. The server render uses the theme from the request's cookie. */
export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const serverTheme = useRouteContext({ from: '__root__', select: (context) => context.theme })
  const theme = useSyncExternalStore(subscribe, readBrowserTheme, () => serverTheme)
  const setTheme = useCallback((next: ThemeId) => {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    for (const listener of listeners) listener()
  }, [])
  return [theme, setTheme]
}
