import { BUILD_ID } from '../lib/buildId'
import type { LiveUpdate } from '../lib/live'
import { toDeviceUpdate } from './assets.server'
import { toPositionUpdate } from './positions.server'
import { clearSession, getSessionToken } from './session.server'
import { getDevices, openSocket, parseSocketMessage, tokenWasRejected, type TraccarDevice, type TraccarPosition } from './traccar.server'

// GET /live: relays Traccar's WebSocket to the browser as Server-Sent Events. The browser never
// talks to Traccar and never sees the token. One upstream socket per open tab.

/** Comment lines keep proxies from closing a quiet stream. */
const HEARTBEAT_MS = 25_000
/** How long EventSource waits before reconnecting after the stream ends. */
const RETRY_MS = 5_000
const CONNECT_TIMEOUT_MS = 10_000
/** How often a stream with a `check` asks whether it may go on. */
const CHECK_MS = 60_000

export async function liveResponse(request: Request): Promise<Response> {
  const token = await getSessionToken()
  if (!token) return new Response('Not signed in', { status: 401 })

  const socket = await connectUpstream(token)
  if (!socket) return failureResponse(token)
  return relay(request, socket, ({ devices, positions }) => [...devices.map(toDeviceUpdate), ...positions.map(toPositionUpdate)])
}

type SocketMessage = { devices: TraccarDevice[]; positions: TraccarPosition[] }

type RelayOptions = {
  /** End the stream at this time (ms since epoch), e.g. when a live location link expires. */
  endAt?: number
  /**
   * Asked every minute; false ends the stream. Traccar keeps an open socket going after its token
   * is revoked, so this is how a stopped link stops pages that are already open.
   */
  check?: () => Promise<boolean>
}

/**
 * Relays Traccar's socket to the browser as Server-Sent Events, each message turned into updates
 * by `convert`. A stream that ends for good (see RelayOptions) sends an `ended` event first, so the
 * browser doesn't reconnect.
 */
export function relay(
  request: Request,
  socket: WebSocket,
  convert: (message: SocketMessage) => LiveUpdate[],
  { endAt, check }: RelayOptions = {},
): Response {
  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false
      const send = (chunk: string) => {
        if (!stopped) controller.enqueue(encoder.encode(chunk))
      }
      const heartbeat = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_MS)
      const end = () => {
        send('event: ended\ndata: \n\n')
        stop()
      }
      const endTimer = endAt === undefined ? undefined : setTimeout(end, Math.max(0, endAt - Date.now()))
      const checker =
        check &&
        setInterval(() => {
          check()
            .then((ok) => {
              if (!ok) end()
            })
            .catch(() => {})
        }, CHECK_MS)
      stop = () => {
        if (stopped) return
        stopped = true
        clearInterval(heartbeat)
        clearTimeout(endTimer)
        clearInterval(checker)
        request.signal.removeEventListener('abort', stop)
        socket.close()
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }

      send(`retry: ${RETRY_MS}\n\n`)
      // Which build is serving, so a page from an older one can offer to reload.
      send(`event: version\ndata: ${BUILD_ID}\n\n`)
      socket.addEventListener('message', (event) => {
        const updates = toUpdates(event.data, convert)
        if (updates.length > 0) send(`data: ${JSON.stringify(updates)}\n\n`)
      })
      // When Traccar drops the socket, end the stream; EventSource reconnects on its own.
      socket.addEventListener('close', () => stop())
      socket.addEventListener('error', () => stop())
      request.signal.addEventListener('abort', stop)
    },
    cancel() {
      stop()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Stops nginx-style proxies from buffering the stream.
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Resolves with the open socket, or null if it doesn't open. */
export function connectUpstream(token: string): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    const socket = openSocket(token)
    const timeout = setTimeout(() => {
      socket.close()
      resolve(null)
    }, CONNECT_TIMEOUT_MS)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout)
        resolve(socket)
      },
      { once: true },
    )
    const fail = () => {
      clearTimeout(timeout)
      resolve(null)
    }
    socket.addEventListener('error', fail, { once: true })
    socket.addEventListener('close', fail, { once: true })
  })
}

/** The socket gives no reason when it's refused, so ask the REST API whether the token is still good. */
async function failureResponse(token: string): Promise<Response> {
  try {
    await getDevices(token)
  } catch (error) {
    if (await tokenWasRejected(token, error)) {
      await clearSession()
      return new Response('Not signed in', { status: 401 })
    }
  }
  return new Response('Traccar live updates are unavailable', { status: 502 })
}

function toUpdates(data: unknown, convert: (message: SocketMessage) => LiveUpdate[]): LiveUpdate[] {
  if (typeof data !== 'string') return []
  try {
    return convert(parseSocketMessage(data))
  } catch (error) {
    // One odd message shouldn't end the stream.
    console.warn('Ignoring Traccar socket message:', error instanceof Error ? error.message : error)
    return []
  }
}
