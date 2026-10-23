// A stand-in Traccar for developing panopticon without a real server or tracker. Made-up data only.
//
//   node dev/mock-traccar.mjs            (listens on 127.0.0.1:8082)
//   echo TRACCAR_URL=http://127.0.0.1:8082 > .env.development.local
//
// Sign in as pet@example.com / secret, or viewer@example.com / secret (can't change assets).
// Event forwarding, for alerts: FORWARD_URL=http://localhost:3001/hooks/traccar-events and
// FORWARD_HEADER='Authorization: Bearer <TRACCAR_EVENTS_SECRET>' post live events there, as
// Traccar's event.forward.url and event.forward.header do. DELAY_MS=800 makes it a slow Traccar.
// BATTERY_DAYS=5 has the batteries run down over five days and get charged (62% by default, as in the screenshots).
// SIXTEN_AT_HOME=1 has Sixten walk to Home instead of daycare, so two assets share Home's pin.
// HISTORY_HOURS=720 gives Betty a month of walks for the Stats card (6 hours by default), with
// a rest day now and then.
// Assets: Betty (photo, lives at Home and goes for a walk round Södermalm every three hours; the
// mock starts just after she's back), Sixten (at daycare since a walk there) and Bamse (offline, no
// position). Places: Home (Betty's) and Daycare (Sixten's). Only the endpoints panopticon uses,
// roughly as Traccar answers them. The front page's screenshots are taken against this (README).
// It also answers address searches as a Nominatim server would (`GET /search`, made-up addresses near
// the places), for GEOCODER_URL=http://127.0.0.1:8082.

import crypto from 'node:crypto'
import http from 'node:http'
import zlib from 'node:zlib'

const PORT = Number(process.env.PORT ?? 8082)
/** How often a walking dog's tracker reports; a still one reports less often. */
const STEP_MS = Number(process.env.STEP_MS ?? 5000)
/** A slow Traccar, for trying loading screens: every API request waits this long (ms), position history three times as long. */
const DELAY_MS = Number(process.env.DELAY_MS ?? 0)
/** Over how many days a battery runs down before it's charged; unset, it stays at 62%. */
const BATTERY_DAYS = Number(process.env.BATTERY_DAYS ?? 0)
/** The battery at a time: from 100% down to 10% over BATTERY_DAYS, then charged over two hours. */
function batteryAt(time) {
  if (!BATTERY_DAYS) return 62
  const cycle = BATTERY_DAYS * 86_400_000
  const charging = 2 * 3_600_000
  const into = ((time % (cycle + charging)) + cycle + charging) % (cycle + charging)
  return Math.round(into < cycle ? 100 - (into / cycle) * 90 : 10 + ((into - cycle) / charging) * 90)
}
/** How far back Betty's history goes, in hours. */
const HISTORY_HOURS = Number(process.env.HISTORY_HOURS ?? 6)

const users = [
  { id: 1, name: 'Adam', email: 'pet@example.com', password: 'secret', readonly: false, deviceReadonly: false, deviceLimit: -1 },
  { id: 2, name: 'Viewer', email: 'viewer@example.com', password: 'secret', readonly: false, deviceReadonly: true, deviceLimit: 0 },
]
const sessions = new Map() // JSESSIONID -> user id
const tokens = new Map() // token -> { userId, expiration }
const revoked = new Set()

const iso = (time) => new Date(time).toISOString()
const start = Date.now()

const devices = [
  {
    id: 30,
    name: 'Betty',
    uniqueId: '9171000030',
    status: 'online',
    lastUpdate: iso(start),
    disabled: false,
    model: 'ST-904L',
    attributes: { deviceImage: 'device.png' },
  },
  {
    id: 10,
    name: 'Sixten',
    uniqueId: '9171000010',
    status: 'online',
    lastUpdate: iso(start),
    disabled: false,
    model: 'ST-904L',
    attributes: {},
  },
  {
    id: 20,
    name: 'Bamse',
    uniqueId: '9171000020',
    status: 'offline',
    lastUpdate: iso(start - 3 * 3600_000),
    disabled: false,
    model: null,
    attributes: {},
  },
]
let nextDeviceId = 100

// --- Geofences (places): checked against every position, like Traccar's GeofenceUtil ---

const geofences = [
  { id: 1, name: 'Daycare', description: null, area: 'CIRCLE (59.3577 18.0912, 120)', calendarId: 0, attributes: {} },
  { id: 2, name: 'Home', description: null, area: 'CIRCLE (59.3132 18.0785, 50)', calendarId: 0, attributes: {} },
]
let nextGeofenceId = 3

/** Made-up addresses near the places, for address searches (GET /search). */
const ADDRESSES = [
  { road: 'Åsögatan', house_number: '140', postcode: '116 24', city: 'Stockholm', lat: 59.31318, lon: 18.07866 },
  { road: 'Åsögatan', house_number: '142', postcode: '116 24', city: 'Stockholm', lat: 59.31322, lon: 18.07905 },
  { road: 'Lidingövägen', house_number: '75', postcode: '115 41', city: 'Stockholm', lat: 59.35752, lon: 18.09098 },
]
/** Device-geofence links, as "deviceId:geofenceId". */
const links = new Set(['30:2', '10:1'])
if (process.env.SIXTEN_AT_HOME) links.add('10:2')
const events = []
let nextEventId = 1
/** Each device's geofences at its latest position, to notice arriving and leaving. */
const insideBefore = new Map()
/** Set once the made-up history is in place: only live events are forwarded. */
let forwarding = false

/** Posts an event like Traccar's JSON event forwarder: the event with its position, device and geofence. */
function forwardEvent(event, position) {
  const url = process.env.FORWARD_URL
  if (!forwarding || !url) return
  const headers = { 'Content-Type': 'application/json' }
  const [name, ...value] = (process.env.FORWARD_HEADER ?? '').split(':')
  if (value.length) headers[name.trim()] = value.join(':').trim()
  const body = {
    event,
    position,
    device: devices.find((device) => device.id === event.deviceId),
    geofence: geofences.find((geofence) => geofence.id === event.geofenceId),
  }
  fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    .then((response) => console.log(`forwarded ${event.type} → HTTP ${response.status}`))
    .catch((error) => console.log(`forwarding ${event.type} failed: ${error.message}`))
}

function contains(area, lat, lon) {
  const circle = /^CIRCLE \((\S+) (\S+), (\S+)\)$/.exec(area)
  if (circle) {
    const [cLat, cLon, radius] = circle.slice(1).map(Number)
    const dy = (lat - cLat) * 111_320
    const dx = (lon - cLon) * 111_320 * Math.cos((cLat * Math.PI) / 180)
    return Math.hypot(dx, dy) <= radius
  }
  const polygon = /^POLYGON \(\((.*)\)\)$/.exec(area)
  if (!polygon) return false
  const ring = polygon[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number))
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLat, aLon] = ring[i]
    const [bLat, bLon] = ring[j]
    if (aLon > lon !== bLon > lon && lat < ((bLat - aLat) * (lon - aLon)) / (bLon - aLon) + aLat) inside = !inside
  }
  return inside
}

/** The device's geofences a position is inside; recording arrivals and departures as events. */
function geofencesAt(deviceId, time, lat, lon, positionId) {
  const ids = geofences
    .filter((geofence) => links.has(`${deviceId}:${geofence.id}`) && contains(geofence.area, lat, lon))
    .map((geofence) => geofence.id)
  const before = insideBefore.get(deviceId) ?? []
  const event = (type, geofenceId) => {
    const recorded = { id: nextEventId++, type, eventTime: iso(time), deviceId, positionId, geofenceId, maintenanceId: 0, attributes: {} }
    events.push(recorded)
    forwardEvent(recorded, { id: positionId, deviceId, latitude: lat, longitude: lon, fixTime: iso(time) })
  }
  for (const id of before) if (!ids.includes(id)) event('geofenceExit', id)
  for (const id of ids) if (!before.includes(id)) event('geofenceEnter', id)
  insideBefore.set(deviceId, ids)
  return ids
}

// --- Positions ---

let nextPositionId = 1
/** An ST-904L report: h02, with its unnamed extra values (see tracker.server.ts). */
function report(deviceId, time, lat, lon, valid = true) {
  const id = nextPositionId++
  return {
    id,
    deviceId,
    protocol: 'h02',
    valid,
    fixTime: iso(time),
    deviceTime: iso(time),
    serverTime: iso(time),
    latitude: lat,
    longitude: lon,
    accuracy: 0,
    geofenceIds: valid ? geofencesAt(deviceId, time, lat, lon, id) : (insideBefore.get(deviceId) ?? []),
    attributes: {
      io1: '240',
      io2: '01',
      io3: '1234',
      io4: String(25637899 + (deviceId % 7)),
      io5: valid ? String(9 + (nextPositionId % 9)) : '0',
      io6: String(16 + (nextPositionId % 12)),
      io7: '37',
      io8: String(batteryAt(time)),
      batteryLevel: batteryAt(time),
    },
  }
}

const history = new Map(devices.map((device) => [device.id, []]))
const DAYCARE = [59.3577, 18.0912]
const HOME = [59.3132, 18.0785]
/** Where Sixten ends up: daycare, or Home with SIXTEN_AT_HOME. */
const SIXTEN_SPOT = process.env.SIXTEN_AT_HOME ? HOME : DAYCARE
const jitter = () => (Math.random() - 0.5) * 0.0003
/** A still tracker (asleep, or indoors) reports this often. */
const STILL_MS = 60_000

// Sixten: walked to daycare between three and two hours ago, and has been there since.
{
  const from = [59.3455, 18.0815]
  const walkStart = start - 3 * 3600_000
  for (let t = walkStart; t < start; t += 30_000) {
    const progress = Math.min(1, (t - walkStart) / 3600_000)
    const [lat, lon] =
      progress < 1 ? [from[0] + (SIXTEN_SPOT[0] - from[0]) * progress, from[1] + (SIXTEN_SPOT[1] - from[1]) * progress] : SIXTEN_SPOT
    history.get(10).push(report(10, t, lat + jitter() * (progress < 1 ? 0.3 : 1), lon + jitter() * (progress < 1 ? 0.3 : 1)))
  }
}

// Betty: a made-up dog walk on Södermalm, along real streets, steps and paths: from home by
// Åsögatan to a sniff at Nytorget, play in Vitabergsparken, the view from Fjällgatan, a sniff by
// Katarina kyrka and home again, about 2.9 km in 50 minutes. The route came once from Valhalla's
// pedestrian router (the one Snap to paths uses, see README) and is kept here, simplified; nothing
// is fetched at run time. Each point: latitude, longitude, and how long she stops there (s).
const ROUTE = [
  [59.3132, 18.0785, 0],
  [59.31348, 18.07835, 0],
  [59.31374, 18.0804, 0],
  [59.31277, 18.08088, 0],
  [59.31275, 18.0807, 100],
  [59.31277, 18.08088, 0],
  [59.3131, 18.08072, 0],
  [59.3136, 18.0847, 0],
  [59.31294, 18.08501, 0],
  [59.31296, 18.08534, 0],
  [59.31293, 18.08525, 0],
  [59.31267, 18.08549, 0],
  [59.31264, 18.08606, 0],
  [59.31273, 18.0871, 0],
  [59.31258, 18.08717, 0],
  [59.31267, 18.08745, 0],
  [59.31217, 18.08764, 0],
  [59.31198, 18.08788, 0],
  [59.31206, 18.08797, 0],
  [59.31205, 18.088, 420],
  [59.31206, 18.08797, 0],
  [59.31209, 18.08801, 0],
  [59.31224, 18.08782, 0],
  [59.31235, 18.08784, 0],
  [59.31253, 18.08818, 0],
  [59.31264, 18.08809, 0],
  [59.313, 18.08703, 0],
  [59.31313, 18.08694, 0],
  [59.31321, 18.08712, 0],
  [59.31329, 18.08697, 0],
  [59.31552, 18.08604, 0],
  [59.31548, 18.08382, 0],
  [59.31763, 18.08273, 0],
  [59.31769, 18.08288, 0],
  [59.3178, 18.08275, 0],
  [59.31782, 18.08282, 0],
  [59.31778, 18.08302, 0],
  [59.31752, 18.08315, 0],
  [59.31752, 18.0832, 120],
  [59.31752, 18.08315, 0],
  [59.31782, 18.08295, 0],
  [59.31779, 18.08269, 0],
  [59.31787, 18.08211, 0],
  [59.3183, 18.08013, 0],
  [59.3181, 18.07997, 0],
  [59.31802, 18.08011, 0],
  [59.31804, 18.07996, 0],
  [59.31762, 18.08024, 0],
  [59.31738, 18.0785, 0],
  [59.31649, 18.07895, 0],
  [59.31634, 18.07778, 0],
  [59.3163, 18.0778, 90],
  [59.31634, 18.07778, 0],
  [59.31637, 18.07807, 0],
  [59.31596, 18.07898, 0],
  [59.31596, 18.07922, 0],
  [59.31374, 18.0804, 0],
  [59.31348, 18.07835, 0],
  [59.3132, 18.0785, 0],
]
const METRES_PER_DEGREE = 111_320
const walkLegs = ROUTE.slice(1).map(([lat, lon, wait], index) => {
  const from = ROUTE[index]
  const dy = (lat - from[0]) * METRES_PER_DEGREE
  const dx = (lon - from[1]) * METRES_PER_DEGREE * Math.cos((from[0] * Math.PI) / 180)
  // A pace of its own for each stretch, 1.1–1.6 m/s.
  const speed = 1.1 + ((index * 7) % 6) * 0.1
  return { from: [from[0], from[1]], to: [lat, lon], wait, seconds: Math.hypot(dx, dy) / speed }
})
const WALK_MS = walkLegs.reduce((sum, leg) => sum + leg.seconds + leg.wait, 0) * 1000
/**
 * A walk every three hours. The mock starts HOME_SINCE minutes after she got home from one (4 by
 * default); a negative number starts it that long before she's back, to get ready for screenshots.
 */
const CYCLE_MS = 3 * 3600_000
const cycleStart = start - WALK_MS - Number(process.env.HOME_SINCE ?? 4) * 60_000
/** Small, smooth noise from a number, so the same moment always gives the same wobble. */
const wobble = (n, seed) => Math.sin(n * 0.37 + seed) * 0.6 + Math.sin(n * 1.13 + seed * 2) * 0.4
/** Moves a point by up to `metres` of wobble, the same for the same `n`. */
function wander([lat, lon], n, metres) {
  const degrees = metres / METRES_PER_DEGREE
  return [lat + wobble(n, 1) * degrees, lon + (wobble(n, 7) * degrees) / Math.cos((lat * Math.PI) / 180)]
}
/** Where Betty is at a time, and whether she's out walking: 1.1–1.6 m/s, stops, fixes off by ~5 m (~10 m indoors). */
function bettyAt(time) {
  const n = Math.floor(time / STEP_MS)
  let seconds = ((((time - cycleStart) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS) / 1000
  if (seconds * 1000 >= WALK_MS || restDay(time)) return { at: wander(HOME, n, 10), walking: false }
  for (const leg of walkLegs) {
    if (seconds < leg.seconds) {
      const along = seconds / leg.seconds
      const at = [leg.from[0] + (leg.to[0] - leg.from[0]) * along, leg.from[1] + (leg.to[1] - leg.from[1]) * along]
      return { at: wander(at, n, 4.5), walking: true }
    }
    seconds -= leg.seconds
    if (seconds < leg.wait) return { at: wander(leg.to, n, leg.wait > 300 ? 12 : 4.5), walking: true }
    seconds -= leg.wait
  }
  return { at: wander(HOME, n, 10), walking: false }
}
/** A day she stays in, every ninth day before yesterday, so the Stats card's streak has an end. */
function restDay(time) {
  const daysAgo = Math.floor((start - time) / 86_400_000)
  return daysAgo >= 2 && new Date(time).getDate() % 9 === 0
}
// Six hours back (HISTORY_HOURS), so the arrivals list has the walk before this one too.
{
  let lastReport = -Infinity
  for (let t = start - HISTORY_HOURS * 3600_000; t <= start; t += STEP_MS) {
    const { at, walking } = bettyAt(t)
    if (!walking && t - lastReport < STILL_MS) continue
    history.get(30).push(report(30, t, ...at))
    lastReport = t
  }
}

const latest = () =>
  devices.flatMap((device) => {
    const positions = history.get(device.id) ?? []
    return positions.length ? [positions.at(-1)] : []
  })

// --- A photo for Betty: a small PNG made here, so there's no file to keep ---

function makePng() {
  const W = 96
  const raw = Buffer.alloc((W * 4 + 1) * W)
  for (let y = 0; y < W; y++) {
    raw[y * (W * 4 + 1)] = 0
    for (let x = 0; x < W; x++) {
      const i = y * (W * 4 + 1) + 1 + x * 4
      const d = Math.hypot(x - 47.5, y - 47.5)
      const ring = d < 20 || (d > 30 && d < 38)
      raw.set(ring ? [250, 230, 210, 255] : [196, 120, 60, 255], i)
    }
  }
  const crc = (buffer) => {
    let c = ~0
    for (const byte of buffer) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(W, 0)
  header.writeUInt32BE(W, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const PHOTO = makePng()

// --- HTTP ---

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

function text(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(body)
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  administrator: false,
  readonly: user.readonly,
  deviceReadonly: user.deviceReadonly,
  deviceLimit: user.deviceLimit,
})

function tokenUser(token) {
  const data = tokens.get(token)
  if (!data || revoked.has(token) || data.expiration < Date.now()) return null
  return data.userId
}

function cookieSession(req) {
  return /JSESSIONID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null
}

/** The signed-in user's id: a bearer token, or a session cookie. */
function authUser(req) {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return tokenUser(auth.slice(7))
  const sid = cookieSession(req)
  return sid ? (sessions.get(sid) ?? null) : null
}

function openSession(res, userId, body) {
  const sid = crypto.randomBytes(12).toString('hex')
  sessions.set(sid, userId)
  json(res, 200, body, { 'Set-Cookie': `JSESSIONID=${sid}; Path=/; HttpOnly` })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock')
  const key = `${req.method} ${url.pathname}`
  console.log(new Date().toISOString().slice(11, 19), key, url.search.slice(0, 60))
  if (DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, url.searchParams.has('from') ? DELAY_MS * 3 : DELAY_MS))

  if (key === 'GET /search') {
    // Every word asked for, anywhere in the address.
    const words = (url.searchParams.get('q') ?? '')
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean)
    const found = ADDRESSES.filter((address) => {
      const text = `${address.road} ${address.house_number} ${address.postcode} ${address.city}`.toLowerCase()
      return words.length > 0 && words.every((word) => text.includes(word))
    })
    return json(
      res,
      200,
      found.map(({ lat, lon, ...address }) => ({
        lat: String(lat),
        lon: String(lon),
        display_name: `${address.house_number}, ${address.road}, ${address.city}`,
        address,
      })),
    )
  }

  if (key === 'GET /api/server') {
    return json(res, 200, { id: 1, registration: false, readonly: false, deviceReadonly: false, openIdEnabled: true, openIdForce: false })
  }

  if (key === 'POST /api/session') {
    const form = new URLSearchParams((await readBody(req)).toString())
    const user = users.find((candidate) => candidate.email === form.get('email'))
    if (!user || user.password !== form.get('password')) return json(res, 401, {})
    return openSession(res, user.id, publicUser(user))
  }
  if (key === 'GET /api/session') {
    const token = url.searchParams.get('token')
    if (token) {
      const userId = tokenUser(token)
      if (!userId) return json(res, 400, {})
      return openSession(res, userId, publicUser(users.find((user) => user.id === userId)))
    }
    const userId = authUser(req)
    if (!userId) return json(res, 404, {})
    return json(res, 200, publicUser(users.find((user) => user.id === userId)))
  }
  if (key === 'DELETE /api/session') {
    sessions.delete(cookieSession(req))
    res.writeHead(204)
    return res.end()
  }
  if (key === 'POST /api/session/token') {
    const userId = authUser(req)
    if (!userId) return json(res, 401, {})
    const form = new URLSearchParams((await readBody(req)).toString())
    const expiration = Date.parse(form.get('expiration') ?? '')
    if (Number.isNaN(expiration)) return json(res, 400, {})
    const token = `tok_${crypto.randomBytes(16).toString('hex')}`
    tokens.set(token, { userId, expiration })
    return text(res, 200, token)
  }
  if (key === 'POST /api/session/token/revoke') {
    if (!authUser(req)) return json(res, 401, {})
    revoked.add(new URLSearchParams((await readBody(req)).toString()).get('token'))
    res.writeHead(204)
    return res.end()
  }

  // Everything below needs a signed-in user.
  const userId = authUser(req)
  if (!userId) return json(res, 401, {})
  const user = users.find((candidate) => candidate.id === userId)

  if (key === 'GET /api/devices') {
    const id = Number(url.searchParams.get('id'))
    return json(res, 200, id ? devices.filter((device) => device.id === id) : devices)
  }
  if (key === 'POST /api/devices') {
    if (user.deviceReadonly) return json(res, 400, {})
    const body = JSON.parse((await readBody(req)).toString())
    const device = {
      id: nextDeviceId++,
      name: body.name,
      uniqueId: body.uniqueId,
      status: 'unknown',
      lastUpdate: null,
      disabled: false,
      model: null,
      attributes: {},
    }
    devices.push(device)
    history.set(device.id, [])
    return json(res, 200, device)
  }
  const deviceMatch = /^\/api\/devices\/(\d+)(\/image)?$/.exec(url.pathname)
  if (deviceMatch) {
    const device = devices.find((candidate) => candidate.id === Number(deviceMatch[1]))
    if (!device) return json(res, 404, {})
    if (deviceMatch[2] && req.method === 'POST') {
      if (user.deviceReadonly) return json(res, 400, {})
      await readBody(req)
      return text(res, 200, 'device.png')
    }
    if (req.method === 'GET') return json(res, 200, device)
    if (user.deviceReadonly) return json(res, 400, {})
    if (req.method === 'PUT') {
      Object.assign(device, JSON.parse((await readBody(req)).toString()))
      broadcast({ devices: [device] })
      return json(res, 200, device)
    }
    if (req.method === 'DELETE') {
      devices.splice(devices.indexOf(device), 1)
      res.writeHead(204)
      return res.end()
    }
  }

  if (key === 'GET /api/positions') {
    const deviceId = Number(url.searchParams.get('deviceId'))
    if (!deviceId) return json(res, 200, latest())
    const from = Date.parse(url.searchParams.get('from') ?? '')
    const to = Date.parse(url.searchParams.get('to') ?? '')
    return json(
      res,
      200,
      (history.get(deviceId) ?? []).filter((position) => {
        const time = Date.parse(position.fixTime)
        return time >= from && time <= to
      }),
    )
  }

  if (key === 'GET /api/geofences') {
    const deviceId = Number(url.searchParams.get('deviceId'))
    return json(res, 200, deviceId ? geofences.filter((geofence) => links.has(`${deviceId}:${geofence.id}`)) : geofences)
  }
  if (key === 'POST /api/geofences') {
    if (user.readonly) return json(res, 400, {})
    const body = JSON.parse((await readBody(req)).toString())
    const geofence = {
      id: nextGeofenceId++,
      name: body.name,
      description: null,
      area: body.area,
      calendarId: 0,
      attributes: body.attributes ?? {},
    }
    geofences.push(geofence)
    return json(res, 200, geofence)
  }
  const geofenceMatch = /^\/api\/geofences\/(\d+)$/.exec(url.pathname)
  if (geofenceMatch) {
    const geofence = geofences.find((candidate) => candidate.id === Number(geofenceMatch[1]))
    if (!geofence) return json(res, 404, {})
    if (req.method === 'GET') return json(res, 200, geofence)
    if (user.readonly) return json(res, 400, {})
    if (req.method === 'PUT') {
      Object.assign(geofence, JSON.parse((await readBody(req)).toString()))
      return json(res, 200, geofence)
    }
    if (req.method === 'DELETE') {
      geofences.splice(geofences.indexOf(geofence), 1)
      for (const link of links) if (link.endsWith(`:${geofence.id}`)) links.delete(link)
      res.writeHead(204)
      return res.end()
    }
  }
  if (url.pathname === '/api/permissions' && (req.method === 'POST' || req.method === 'DELETE')) {
    // Linking a device needs edit rights to it, as in Traccar.
    if (user.deviceReadonly) return json(res, 400, { message: 'Account is device readonly' })
    const { deviceId, geofenceId } = JSON.parse((await readBody(req)).toString())
    if (req.method === 'POST') links.add(`${deviceId}:${geofenceId}`)
    else links.delete(`${deviceId}:${geofenceId}`)
    res.writeHead(204)
    return res.end()
  }
  if (key === 'GET /api/server/geocode') {
    const lat = Number(url.searchParams.get('latitude'))
    return text(res, 200, lat > 59.35 ? 'Storviltsgatan 5, Stockholm' : 'Ringvägen 12, Stockholm')
  }

  if (url.pathname.startsWith('/api/media/')) {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    return res.end(PHOTO)
  }

  json(res, 404, {})
})

// --- WebSocket (/api/socket): Traccar pushes devices and positions as JSON text frames ---

const sockets = new Set()

function frame(textMessage) {
  const payload = Buffer.from(textMessage)
  let header
  if (payload.length < 126) header = Buffer.from([0x81, payload.length])
  else if (payload.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  return Buffer.concat([header, payload])
}

function broadcast(message) {
  const data = frame(JSON.stringify(message))
  for (const socket of sockets) socket.write(data)
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://mock')
  if (url.pathname !== '/api/socket' || !tokenUser(url.searchParams.get('token'))) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return
  }
  const accept = crypto
    .createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  sockets.add(socket)
  socket.write(frame(JSON.stringify({ devices, positions: latest() })))
  socket.on('data', (buffer) => {
    // A close frame from the client: close too.
    if ((buffer[0] & 0x0f) === 0x8) socket.end()
  })
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => sockets.delete(socket))
})

// Betty reports every step while she's out and every minute at home; Sixten every minute from daycare.
let tick = 0
setInterval(() => {
  const now = Date.now()
  const betty = bettyAt(now)
  const still = tick++ % Math.max(1, Math.round(STILL_MS / STEP_MS)) === 0
  const positions = []
  if (betty.walking || still) positions.push(report(30, now, ...betty.at))
  if (still) positions.push(report(10, now, SIXTEN_SPOT[0] + jitter(), SIXTEN_SPOT[1] + jitter()))
  for (const position of positions) {
    history.get(position.deviceId)?.push(position)
    const device = devices.find((candidate) => candidate.id === position.deviceId)
    if (device) device.lastUpdate = position.fixTime
  }
  broadcast({ positions })
}, STEP_MS)

forwarding = true
server.listen(PORT, '127.0.0.1', () => console.log(`Mock Traccar on http://127.0.0.1:${PORT}`))
