import { createFileRoute } from '@tanstack/react-router'
import { handleTraccarEvent } from '../server/alerts.server'

// Traccar's event forwarding (`event.forward.url`), for alerts: see alerts.server.ts.
export const Route = createFileRoute('/hooks/traccar-events')({
  server: {
    handlers: {
      POST: ({ request }) => handleTraccarEvent(request),
    },
  },
})
