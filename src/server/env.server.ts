type Env = {
  traccarUrl: string
  sessionSecret: string
  sessionDays: number
}

let cached: Env | undefined

/** Server config from environment variables, validated once. Throws with a readable message when misconfigured. */
export function env(): Env {
  cached ??= {
    traccarUrl: readTraccarUrl(),
    sessionSecret: readSessionSecret(),
    sessionDays: readSessionDays(),
  }
  return cached
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  }
  return value
}

function readTraccarUrl(): string {
  const raw = required('TRACCAR_URL')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`TRACCAR_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`TRACCAR_URL must start with https:// or http://, got ${raw}`)
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

function readSessionDays(): number {
  const raw = process.env.SESSION_DAYS?.trim()
  if (!raw) return 30
  const days = Number(raw)
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`SESSION_DAYS must be a whole number of days, got ${raw}`)
  }
  return days
}
