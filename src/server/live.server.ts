import type { LiveUpdate } from '../lib/live'
import { toDeviceUpdate, toPositionUpdate } from './assets.server'
import { clearSession, getSessionToken } from './session.server'
import { getDevices, openSocket, parseSocketMessage, tokenWasRejected } from './traccar.server'

// GET /live: relays Traccar's WebSocket to the browser as Server-Sent Events. The browser never
// talks to Traccar and never sees the token. One upstream socket per open tab.

/** Comment lines keep proxies from closing a quiet stream. */
const HEARTBEAT_MS = 25_000
/** How long EventSource waits before reconnecting after the stream ends. */
const RETRY_MS = 5_000
const CONNECT_TIMEOUT_MS = 10_000

export async function liveResponse(request: Request): Promise<Response> {
  const token = await getSessionToken()
  if (!token) return new Response('Not signed in', { status: 401 })

  const socket = await connectUpstream(token)
  if (!socket) return failureResponse(token)

  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false
      const send = (chunk: string) => {
        if (!stopped) controller.enqueue(encoder.encode(chunk))
      }
      const heartbeat = setInterval(() => send(': keepalive\n\n'), HEARTBEAT_MS)
      stop = () => {
        if (stopped) return
        stopped = true
        clearInterval(heartbeat)
        request.signal.removeEventListener('abort', stop)
        socket.close()
        try {
          controller.close()
        } catch {
          // Already closed by the client.
        }
      }

      send(`retry: ${RETRY_MS}\n\n`)
      socket.addEventListener('message', (event) => {
        const updates = toUpdates(event.data)
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
function connectUpstream(token: string): Promise<WebSocket | null> {
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

function toUpdates(data: unknown): LiveUpdate[] {
  if (typeof data !== 'string') return []
  try {
    const { devices, positions } = parseSocketMessage(data)
    return [...devices.map(toDeviceUpdate), ...positions.map(toPositionUpdate)]
  } catch (error) {
    // One odd message shouldn't end the stream.
    console.warn('Ignoring Traccar socket message:', error instanceof Error ? error.message : error)
    return []
  }
}
