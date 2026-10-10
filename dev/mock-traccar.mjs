// A stand-in Traccar for developing panopticon without a real server or tracker. Made-up data only.
//
//   node dev/mock-traccar.mjs            (listens on 127.0.0.1:8082)
//   echo TRACCAR_URL=http://127.0.0.1:8082 > .env.development.local
//
// Sign in as pet@example.com / secret, or viewer@example.com / secret (can't change assets).
// Assets: Betty (photo, at one spot for two hours after a walk), Sixten (walking a loop, live) and
// Bamse (offline, no position). Only the endpoints panopticon uses, roughly as Traccar answers them.

import crypto from 'node:crypto'
import http from 'node:http'
import zlib from 'node:zlib'

const PORT = Number(process.env.PORT ?? 8082)
/** How often Sixten moves, and how often Betty reports. */
const STEP_MS = Number(process.env.STEP_MS ?? 5000)

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

// --- Positions ---

let nextPositionId = 1
/** An ST-904L report: h02, with its unnamed extra values (see tracker.server.ts). */
function report(deviceId, time, lat, lon, valid = true) {
  return {
    id: nextPositionId++,
    deviceId,
    protocol: 'h02',
    valid,
    fixTime: iso(time),
    deviceTime: iso(time),
    serverTime: iso(time),
    latitude: lat,
    longitude: lon,
    accuracy: 0,
    attributes: {
      io1: '240',
      io2: '01',
      io3: '1234',
      io4: String(25637899 + (deviceId % 7)),
      io5: valid ? String(9 + (nextPositionId % 9)) : '0',
      io6: String(16 + (nextPositionId % 12)),
      io7: '37',
      io8: '62',
      batteryLevel: 62,
    },
  }
}

const history = new Map(devices.map((device) => [device.id, []]))
const DAYCARE = [59.3577, 18.0912]
const jitter = () => (Math.random() - 0.5) * 0.0003

// Betty: walked to daycare between three and two hours ago, and has been there since.
{
  const from = [59.3455, 18.0815]
  const walkStart = start - 3 * 3600_000
  for (let t = walkStart, i = 0; t < start; t += 30_000, i++) {
    const progress = Math.min(1, (t - walkStart) / 3600_000)
    const [lat, lon] = progress < 1 ? [from[0] + (DAYCARE[0] - from[0]) * progress, from[1] + (DAYCARE[1] - from[1]) * progress] : DAYCARE
    history.get(30).push(report(30, t, lat + jitter() * (progress < 1 ? 0.3 : 1), lon + jitter() * (progress < 1 ? 0.3 : 1)))
  }
}

// Sixten: a loop around a block on Södermalm, about 5 km/h.
const LOOP = { lat: 59.3155, lon: 18.072, radius: 0.0025 }
let sixtenStep = 0
function sixtenAt(step) {
  const angle = step * 0.02
  return [LOOP.lat + Math.sin(angle) * LOOP.radius * 0.55, LOOP.lon + Math.cos(angle) * LOOP.radius]
}
for (let t = start - 3 * 3600_000; t <= start; t += STEP_MS) {
  history.get(10).push(report(10, t, ...sixtenAt(sixtenStep++)))
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

// Sixten keeps walking; Betty reports from daycare every few steps.
let tick = 0
setInterval(() => {
  const now = Date.now()
  const positions = [report(10, now, ...sixtenAt(sixtenStep++))]
  if (tick++ % 6 === 0) positions.push(report(30, now, DAYCARE[0] + jitter(), DAYCARE[1] + jitter()))
  for (const position of positions) {
    history.get(position.deviceId)?.push(position)
    const device = devices.find((candidate) => candidate.id === position.deviceId)
    if (device) device.lastUpdate = position.fixTime
  }
  broadcast({ positions })
}, STEP_MS)

server.listen(PORT, '127.0.0.1', () => console.log(`Mock Traccar on http://127.0.0.1:${PORT}`))
