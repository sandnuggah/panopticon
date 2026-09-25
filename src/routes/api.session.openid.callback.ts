import { createFileRoute } from '@tanstack/react-router'
import { finishSso } from '../server/sso.server'

// The path is fixed: Traccar tells the identity provider to return to `web.url` + this path.
export const Route = createFileRoute('/api/session/openid/callback')({
  server: {
    handlers: {
      GET: ({ request }) => finishSso(request),
    },
  },
})
