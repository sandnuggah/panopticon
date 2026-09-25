import { useCallback, useSyncExternalStore } from 'react'
import { useRouteContext } from '@tanstack/react-router'

// Themes are chosen per browser and kept in a cookie (not localStorage) so the server can render
// the right one straight away, without a flash of the default theme. Colours live in styles.css,
// keyed on <html data-theme>.

export const THEMES = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Calm greens. Follows your device’s light or dark mode.',
  },
  {
    id: 'dog',
    label: 'Dog park',
    description: 'Bright pastels, rounder shapes, and paw prints for trails.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'classic'
export const THEME_COOKIE = 'panopticon-theme'

export function parseTheme(value: string | undefined | null): ThemeId {
  return THEMES.some((theme) => theme.id === value) ? (value as ThemeId) : DEFAULT_THEME
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
