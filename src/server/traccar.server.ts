import { env } from './env.server'

// Typed client for the few Traccar endpoints panopticon uses. Responses are checked
// field by field so a changed Traccar API fails loudly instead of rendering nonsense.

export type TraccarUser = {
  id: number
  name: string
  email: string
}

export type TraccarDevice = {
  id: number
  name: string
  status: 'online' | 'offline' | 'unknown'
  lastUpdate: string | null
  disabled: boolean
}

export type TraccarPosition = {
  deviceId: number
  protocol: string | null
  /** False when the tracker had no GPS fix and repeated an old location. */
  valid: boolean
  fixTime: string
  latitude: number
  longitude: number
  accuracy: number
  attributes: Record<string, unknown>
}

export class TraccarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'TraccarError'
  }
}

export type PasswordSessionResult =
  | { kind: 'ok'; user: TraccarUser; sessionCookie: string }
  | { kind: 'code-required' }
  | { kind: 'invalid' }

/** Password sign-in. Returns the Traccar session cookie to exchange for a token. */
export async function createPasswordSession(
  email: string,
  password: string,
  code?: string,
): Promise<PasswordSessionResult> {
  const body = new URLSearchParams({ email, password })
  if (code) body.set('code', code)
  const response = await request('/api/session', { method: 'POST', body })
  if (response.status === 401) {
    const challenge = response.headers.get('WWW-Authenticate') ?? ''
    return challenge.toUpperCase().includes('TOTP') ? { kind: 'code-required' } : { kind: 'invalid' }
  }
  ensureOk(response, 'POST /api/session')
  const sessionCookie = readSessionCookie(response)
  return { kind: 'ok', user: parseUser(await response.json()), sessionCookie }
}

/** Mints an API token from a Traccar session, then ends that session. */
export async function exchangeSessionForToken(sessionCookie: string, expiresAt: Date): Promise<string> {
  try {
    const response = await request('/api/session/token', {
      method: 'POST',
      cookie: sessionCookie,
      body: new URLSearchParams({ expiration: expiresAt.toISOString() }),
    })
    ensureOk(response, 'POST /api/session/token')
    const token = (await response.text()).trim().replace(/^"|"$/g, '')
    if (!token) throw new TraccarError('Traccar returned an empty token')
    return token
  } finally {
    await request('/api/session', { method: 'DELETE', cookie: sessionCookie }).catch(() => {})
  }
}

export async function revokeToken(token: string): Promise<void> {
  const response = await request('/api/session/token/revoke', {
    method: 'POST',
    token,
    body: new URLSearchParams({ token }),
  })
  ensureOk(response, 'POST /api/session/token/revoke')
}

export async function getDevices(token: string): Promise<TraccarDevice[]> {
  return parseList(await getJson('/api/devices', token), parseDevice)
}

/** Latest position of every device the user can see. */
export async function getLatestPositions(token: string): Promise<TraccarPosition[]> {
  return parseList(await getJson('/api/positions', token), parsePosition)
}

/** Positions of one device between two times, oldest first. Fails for users with reports disabled. */
export async function getPositionHistory(
  token: string,
  deviceId: number,
  from: Date,
  to: Date,
): Promise<TraccarPosition[]> {
  const query = new URLSearchParams({
    deviceId: String(deviceId),
    from: from.toISOString(),
    to: to.toISOString(),
  })
  return parseList(await getJson(`/api/positions?${query}`, token), parsePosition)
}

/** Opens Traccar's live WebSocket. It sends `{devices, positions, events}` messages as things change. */
export function openSocket(token: string): WebSocket {
  const url = env().traccarUrl.replace(/^http/, 'ws') + `/api/socket?token=${encodeURIComponent(token)}`
  return new WebSocket(url)
}

/** Devices and positions from one socket message. Keepalives (`{}`) and events yield empty lists. */
export function parseSocketMessage(text: string): { devices: TraccarDevice[]; positions: TraccarPosition[] } {
  const message: unknown = JSON.parse(text)
  if (!isObject(message)) throw unexpected('socket message is not an object')
  return {
    devices: message.devices == null ? [] : parseList(message.devices, parseDevice),
    positions: message.positions == null ? [] : parseList(message.positions, parsePosition),
  }
}

async function getJson(path: string, token: string): Promise<unknown> {
  const response = await request(path, { token })
  ensureOk(response, `GET ${path}`)
  return response.json()
}

async function request(
  path: string,
  { token, cookie, ...init }: RequestInit & { token?: string; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (cookie) headers.set('Cookie', cookie)
  try {
    return await fetch(env().traccarUrl + path, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new TraccarError(`Could not reach Traccar at ${env().traccarUrl}: ${reason}`)
  }
}

function ensureOk(response: Response, what: string): void {
  if (!response.ok) {
    throw new TraccarError(`${what} failed with HTTP ${response.status}`, response.status)
  }
}

function readSessionCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';', 1)[0]!.trim())
    .find((pair) => pair.startsWith('JSESSIONID='))
  if (!cookie) throw new TraccarError('Traccar did not return a session cookie')
  return cookie
}

// Response parsing

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseList<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw unexpected('expected a list')
  return value.map(parse)
}

function parseUser(value: unknown): TraccarUser {
  if (!isObject(value)) throw unexpected('user is not an object')
  return {
    id: number(value, 'id', 'user'),
    name: optionalString(value, 'name', 'user') ?? '',
    email: string(value, 'email', 'user'),
  }
}

function parseDevice(value: unknown): TraccarDevice {
  if (!isObject(value)) throw unexpected('device is not an object')
  const status = optionalString(value, 'status', 'device')
  return {
    id: number(value, 'id', 'device'),
    name: string(value, 'name', 'device'),
    status: status === 'online' || status === 'offline' ? status : 'unknown',
    lastUpdate: optionalString(value, 'lastUpdate', 'device'),
    disabled: value.disabled === true,
  }
}

function parsePosition(value: unknown): TraccarPosition {
  if (!isObject(value)) throw unexpected('position is not an object')
  const attributes = value.attributes ?? {}
  if (!isObject(attributes)) throw unexpected('position.attributes is not an object')
  return {
    deviceId: number(value, 'deviceId', 'position'),
    protocol: optionalString(value, 'protocol', 'position'),
    valid: value.valid !== false,
    fixTime: string(value, 'fixTime', 'position'),
    latitude: number(value, 'latitude', 'position'),
    longitude: number(value, 'longitude', 'position'),
    accuracy: value.accuracy == null ? 0 : number(value, 'accuracy', 'position'),
    attributes,
  }
}

function number(object: Json, key: string, what: string): number {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw unexpected(`${what}.${key} is not a number`)
  return value
}

function string(object: Json, key: string, what: string): string {
  const value = object[key]
  if (typeof value !== 'string') throw unexpected(`${what}.${key} is not a string`)
  return value
}

function optionalString(object: Json, key: string, what: string): string | null {
  const value = object[key]
  if (value == null) return null
  if (typeof value !== 'string') throw unexpected(`${what}.${key} is not a string`)
  return value
}

function unexpected(detail: string): TraccarError {
  return new TraccarError(`Unexpected Traccar response: ${detail}`)
}
