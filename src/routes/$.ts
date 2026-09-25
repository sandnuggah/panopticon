import { createFileRoute, notFound } from '@tanstack/react-router'
import { traccarLinkRedirect } from '../server/sso.server'

// Traccar builds links in its emails from `web.url`, which points here once SSO is set up.
// Send those on to Traccar; anything else is an ordinary 404.
export const Route = createFileRoute('/$')({
  server: {
    handlers: {
      GET: ({ request, next }) => traccarLinkRedirect(request) ?? next(),
    },
  },
  loader: () => {
    throw notFound()
  },
  // A component lets the handler defer to the router (next()), which renders the 404 page.
  component: () => null,
})
