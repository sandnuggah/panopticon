import { env } from './env.server'

// Typed client for the few Traccar endpoints panopticon uses. Responses are checked
// field by field so a changed Traccar API fails loudly instead of rendering nonsense.

export type TraccarUser = {
  id: number
  name: string
  email: string
}

/** What a user may change, from their Traccar user record. */
export type TraccarUserAccess = {
  administrator: boolean
  readonly: boolean
  deviceReadonly: boolean
  /** -1 means no limit, 0 means they can't add devices. */
  deviceLimit: number
}

export type TraccarDevice = {
  id: number
  name: string
  /** The tracker's own ID (often its IMEI). Server-only: never send it to the browser. */
  uniqueId: string
  status: 'online' | 'offline' | 'unknown'
  lastUpdate: string | null
  disabled: boolean
  /** Filename of the image uploaded in Traccar's UI (attribute `deviceImage`), if any. */
  image: string | null
  /** The model entered for the device in Traccar, if any. */
  model: string | null
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
  /** The serving cell tower's ID, when Traccar decoded one (`network.cellTowers`). */
  cellId: number | null
  /** The serving cell tower's country and network codes, when Traccar decoded them. */
  cellNetwork: { mcc: number; mnc: number } | null
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
  await ensureOk(response, 'POST /api/session')
  const sessionCookie = readSessionCookie(response)
  return { kind: 'ok', user: parseUser(await response.json()), sessionCookie }
}

/**
 * Public server info. `openIdEnabled` says whether Traccar has SSO configured; `readonly` and
 * `deviceReadonly` are server-wide limits on what non-admin users may change.
 */
export async function getServerInfo(): Promise<{ openIdEnabled: boolean; readonly: boolean; deviceReadonly: boolean }> {
  const response = await request('/api/server')
  await ensureOk(response, 'GET /api/server')
  const value: unknown = await response.json()
  if (!isObject(value)) throw unexpected('server is not an object')
  return {
    openIdEnabled: value.openIdEnabled === true,
    readonly: value.readonly === true,
    deviceReadonly: value.deviceReadonly === true,
  }
}

/** Starts Traccar's OpenID Connect flow. Returns the identity provider URL to send the browser to. */
export async function startOpenIdLogin(): Promise<string> {
  const response = await request('/api/session/openid/auth')
  const location = response.headers.get('Location')
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new TraccarError(`GET /api/session/openid/auth failed with HTTP ${response.status}`, response.status)
  }
  return new URL(location).href
}

export type OpenIdCallbackResult = { kind: 'ok'; sessionCookie: string } | { kind: 'refused'; reason: string }

/** Hands the identity provider's callback to Traccar. On success Traccar has created a session. */
export async function finishOpenIdLogin(query: URLSearchParams): Promise<OpenIdCallbackResult> {
  const response = await request(`/api/session/openid/callback?${query}`)
  if (response.status >= 300 && response.status < 400) {
    return { kind: 'ok', sessionCookie: readSessionCookie(response) }
  }
  // Traccar puts the exception in the body, e.g. "java.lang.SecurityException: Registration disabled".
  const body = await response.text().catch(() => '')
  return { kind: 'refused', reason: body.split('\n', 1)[0]?.trim() || `HTTP ${response.status}` }
}

/** The user a Traccar session cookie belongs to. */
export async function getTraccarSessionUser(sessionCookie: string): Promise<TraccarUser> {
  const response = await request('/api/session', { cookie: sessionCookie })
  await ensureOk(response, 'GET /api/session')
  return parseUser(await response.json())
}

/**
 * The token's user, with the settings that limit what they may change. GET /api/session ignores the
 * Authorization header (it only reads the HTTP session), so this signs in with `?token=`, which
 * returns the user, and ends that session again.
 */
export async function getUserAccess(token: string): Promise<TraccarUserAccess> {
  const response = await request(`/api/session?${new URLSearchParams({ token })}`)
  await ensureOk(response, 'GET /api/session?token')
  await endSession(readSessionCookie(response))
  const value: unknown = await response.json()
  if (!isObject(value)) throw unexpected('user is not an object')
  return {
    administrator: value.administrator === true,
    readonly: value.readonly === true,
    deviceReadonly: value.deviceReadonly === true,
    deviceLimit: typeof value.deviceLimit === 'number' ? value.deviceLimit : -1,
  }
}

export async function endSession(sessionCookie: string): Promise<void> {
  await request('/api/session', { method: 'DELETE', cookie: sessionCookie }).catch(() => {})
}

/** Mints an API token from a Traccar session, then ends that session. */
export async function exchangeSessionForToken(sessionCookie: string, expiresAt: Date): Promise<string> {
  try {
    const response = await request('/api/session/token', {
      method: 'POST',
      cookie: sessionCookie,
      body: new URLSearchParams({ expiration: expiresAt.toISOString() }),
    })
    await ensureOk(response, 'POST /api/session/token')
    const token = (await response.text()).trim().replace(/^"|"$/g, '')
    if (!token) throw new TraccarError('Traccar returned an empty token')
    return token
  } finally {
    await endSession(sessionCookie)
  }
}

/**
 * After a failed call: does it mean the token is no good, so the user must sign in again?
 * Expired or revoked tokens give 401. A token Traccar can't verify at all (from another server, or
 * after its signing key changed) makes its auth filter throw, giving 400 or 500, even on the
 * public /api/server. So compare /api/server with and without the token.
 */
export async function tokenWasRejected(token: string, error: unknown): Promise<boolean> {
  if (!(error instanceof TraccarError) || error.status === undefined) return false
  if (error.status === 401) return true
  const withToken = await request('/api/server', { token }).catch(() => null)
  if (!withToken || withToken.ok) return false
  const withoutToken = await request('/api/server').catch(() => null)
  return withoutToken?.ok === true
}

/**
 * A new token for the same user, expiring at `expiresAt` (Traccar caps it at the current token's
 * own expiry). Used for live location links; see sharing.server.ts.
 */
export async function createToken(token: string, expiresAt: Date): Promise<string> {
  const response = await request('/api/session/token', {
    method: 'POST',
    token,
    body: new URLSearchParams({ expiration: expiresAt.toISOString() }),
  })
  await ensureOk(response, 'POST /api/session/token')
  const created = (await response.text()).trim().replace(/^"|"$/g, '')
  if (!created) throw new TraccarError('Traccar returned an empty token')
  return created
}

export async function revokeToken(token: string): Promise<void> {
  const response = await request('/api/session/token/revoke', {
    method: 'POST',
    token,
    body: new URLSearchParams({ token }),
  })
  await ensureOk(response, 'POST /api/session/token/revoke')
}

export async function getDevices(token: string): Promise<TraccarDevice[]> {
  return parseList(await getJson('/api/devices', token), parseDevice)
}

/** One device, if the user may see it. */
export async function getDevice(token: string, id: number): Promise<TraccarDevice | null> {
  const devices = parseList(await getJson(`/api/devices?id=${id}`, token), parseDevice)
  return devices.find((device) => device.id === id) ?? null
}

/** Adds a device. Traccar gives the creating user access to it. */
export async function createDevice(token: string, name: string, uniqueId: string): Promise<TraccarDevice> {
  const response = await request('/api/devices', { method: 'POST', token, json: { name, uniqueId } })
  await ensureOk(response, 'POST /api/devices')
  return parseDevice(await response.json())
}

/**
 * Changes a device. Traccar's PUT replaces the whole record, so this fetches it, lets `edit` change
 * fields on the full JSON (keeping ones panopticon doesn't know about), and sends it all back.
 */
export async function updateDevice(token: string, id: number, edit: (device: Json) => void): Promise<TraccarDevice> {
  const device = await getJson(`/api/devices/${id}`, token)
  if (!isObject(device) || device.id !== id) throw unexpected('device is not an object')
  edit(device)
  const response = await request(`/api/devices/${id}`, { method: 'PUT', token, json: device })
  await ensureOk(response, `PUT /api/devices/${id}`)
  return parseDevice(await response.json())
}

/** The attributes object of a device's full JSON, created if missing. */
export function deviceAttributes(device: Json): Json {
  if (!isObject(device.attributes)) device.attributes = {}
  return device.attributes as Json
}

export async function deleteDevice(token: string, id: number): Promise<void> {
  const response = await request(`/api/devices/${id}`, { method: 'DELETE', token })
  await ensureOk(response, `DELETE /api/devices/${id}`)
}

/**
 * Stores an image in Traccar's media folder for the device, as device.<ext>. Returns that filename;
 * it still has to be saved in the device's `deviceImage` attribute to be used.
 */
export async function uploadDeviceImage(
  token: string,
  id: number,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<string> {
  const response = await request(`/api/devices/${id}/image`, {
    method: 'POST',
    token,
    body: bytes,
    headers: { 'Content-Type': contentType },
  })
  await ensureOk(response, `POST /api/devices/${id}/image`)
  const filename = (await response.text()).trim()
  if (!/^device\.(jpg|png|gif|webp)$/.test(filename)) throw unexpected(`image upload returned ${filename.slice(0, 40)}`)
  return filename
}

/**
 * A device image from Traccar's media store. That endpoint only accepts a session cookie, not an
 * API token, so this opens a session from the token for the one request and ends it again.
 * Returns null if Traccar has no such file.
 */
export async function getDeviceImage(token: string, uniqueId: string, filename: string): Promise<ArrayBuffer | null> {
  const login = await request(`/api/session?${new URLSearchParams({ token })}`)
  await ensureOk(login, 'GET /api/session?token')
  const sessionCookie = readSessionCookie(login)
  try {
    const response = await request(`/api/media/${encodeURIComponent(uniqueId)}/${filename}`, { cookie: sessionCookie })
    if (response.status === 404) return null
    await ensureOk(response, 'GET /api/media')
    return await response.arrayBuffer()
  } finally {
    await endSession(sessionCookie)
  }
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
/**
 * The address at a point from Traccar's reverse geocoder (`geocoder.*` in traccar.xml), or null when
 * it has none there. Fails like any other call when geocoding is off ("Reverse geocoding is not enabled").
 */
export async function reverseGeocode(token: string, lat: number, lon: number): Promise<string | null> {
  const query = new URLSearchParams({ latitude: String(lat), longitude: String(lon) })
  const response = await request(`/api/server/geocode?${query}`, { token })
  await ensureOk(response, 'GET /api/server/geocode')
  // A bare string, though some versions may quote it as JSON.
  let address: unknown = (await response.text()).trim()
  if (typeof address === 'string' && address.startsWith('"')) address = JSON.parse(address)
  return typeof address === 'string' && address !== '' ? address : null
}

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
  await ensureOk(response, `GET ${path}`)
  return response.json()
}

async function request(
  path: string,
  { token, cookie, json, ...init }: RequestInit & { token?: string; cookie?: string; json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (cookie) headers.set('Cookie', cookie)
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(json)
  }
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

/** Throws for non-2xx. Traccar puts the reason (a Java exception) in the body; its first line goes in the message. */
async function ensureOk(response: Response, what: string): Promise<void> {
  if (response.ok) return
  const body = await response.text().catch(() => '')
  const reason = body.split('\n', 1)[0]!.trim().slice(0, 200)
  throw new TraccarError(`${what} failed with HTTP ${response.status}${reason ? `: ${reason}` : ''}`, response.status)
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

export type Json = Record<string, unknown>

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
    uniqueId: string(value, 'uniqueId', 'device'),
    lastUpdate: optionalString(value, 'lastUpdate', 'device'),
    disabled: value.disabled === true,
    image: readDeviceImage(value.attributes),
    model: typeof value.model === 'string' && value.model.trim() !== '' ? value.model.trim() : null,
  }
}

/** Traccar always stores uploads as device.<ext>; anything else is ignored, which also rules out odd paths. */
function readDeviceImage(attributes: unknown): string | null {
  if (!isObject(attributes)) return null
  const image = attributes.deviceImage
  return typeof image === 'string' && /^device\.(jpg|png|gif|webp)$/.test(image) ? image : null
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
    cellId: readCellId(value.network),
    cellNetwork: readCellNetwork(value.network),
    attributes,
  }
}

/** The first cell tower's ID from Traccar's `network` object; it's optional and loosely shaped, so no errors. */
function readCellNetwork(network: unknown): TraccarPosition['cellNetwork'] {
  if (!isObject(network) || !Array.isArray(network.cellTowers)) return null
  const tower: unknown = network.cellTowers[0]
  if (!isObject(tower)) return null
  const { mobileCountryCode: mcc, mobileNetworkCode: mnc } = tower
  return Number.isInteger(mcc) && Number.isInteger(mnc) ? { mcc: mcc as number, mnc: mnc as number } : null
}

function readCellId(network: unknown): number | null {
  if (!isObject(network) || !Array.isArray(network.cellTowers)) return null
  const tower: unknown = network.cellTowers[0]
  return isObject(tower) && typeof tower.cellId === 'number' && Number.isInteger(tower.cellId) ? tower.cellId : null
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
