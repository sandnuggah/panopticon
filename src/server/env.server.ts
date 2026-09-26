type Env = {
  traccarUrl: string
  /** Where browsers reach Traccar's own UI (email-link redirects). Defaults to traccarUrl. */
  traccarPublicUrl: string
  sessionSecret: string
  sessionDays: number
  mapStyleUrl: string
  /** Origins the map may load from (CSP): the style's own, plus MAP_EXTRA_ORIGINS. */
  mapOrigins: string[]
  /** Which sign-in methods the login page offers and the server accepts (SIGN_IN_METHODS). */
  signInMethods: { password: boolean; sso: boolean }
}

const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

let cached: Env | undefined

/** Server config from environment variables, validated once. Throws with a readable message when misconfigured. */
export function env(): Env {
  if (!cached) {
    const mapStyleUrl = readMapStyleUrl()
    const traccarUrl = readUrl('TRACCAR_URL', true)!
    cached = {
      traccarUrl,
      traccarPublicUrl: readUrl('TRACCAR_PUBLIC_URL', false) ?? traccarUrl,
      sessionSecret: readSessionSecret(),
      sessionDays: readSessionDays(),
      mapStyleUrl,
      mapOrigins: [new URL(mapStyleUrl).origin, ...readMapExtraOrigins()],
      signInMethods: readSignInMethods(),
    }
  }
  return cached
}

/** For styles that load tiles, fonts or sprites from other hosts than the style itself. */
function readMapExtraOrigins(): string[] {
  const raw = process.env.MAP_EXTRA_ORIGINS?.trim()
  if (!raw) return []
  return raw.split(',').map((value) => {
    try {
      return new URL(value.trim()).origin
    } catch {
      throw new Error(`MAP_EXTRA_ORIGINS has an invalid URL: ${value.trim()}`)
    }
  })
}

/** Comma-separated `password` and/or `sso`; both when unset. SSO also needs OpenID set up in Traccar. */
function readSignInMethods(): { password: boolean; sso: boolean } {
  const raw = process.env.SIGN_IN_METHODS?.trim()
  if (!raw) return { password: true, sso: true }
  const methods = raw
    .toLowerCase()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const unknown = methods.filter((method) => method !== 'password' && method !== 'sso')
  if (unknown.length > 0 || methods.length === 0) {
    throw new Error(`SIGN_IN_METHODS must be password, sso, or both separated by a comma, got ${raw}`)
  }
  return { password: methods.includes('password'), sso: methods.includes('sso') }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  }
  return value
}

function readUrl(name: string, isRequired: boolean): string | undefined {
  const raw = isRequired ? required(name) : process.env[name]?.trim()
  if (!raw) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must start with https:// or http://, got ${raw}`)
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function readSessionSecret(): string {
  const secret = required('SESSION_SECRET')
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32')
  }
  return secret
}

function readMapStyleUrl(): string {
  const raw = process.env.MAP_STYLE_URL?.trim()
  if (!raw) return DEFAULT_MAP_STYLE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`MAP_STYLE_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`MAP_STYLE_URL must start with https:// or http://, got ${raw}`)
  }
  return url.href
}

function readSessionDays(): number {
  const raw = process.env.SESSION_DAYS?.trim()
  if (!raw) return 30
  const days = Number(raw)
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`SESSION_DAYS must be a whole number of days, got ${raw}`)
  }
  return days
}
