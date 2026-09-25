import { getRequestHeader } from '@tanstack/react-start/server'
import { themeFromCookieHeader, type ThemeId } from '../lib/theme'

/** The theme chosen in this browser, from the request's cookie. */
export function requestTheme(): ThemeId {
  return themeFromCookieHeader(getRequestHeader('cookie') ?? '')
}
