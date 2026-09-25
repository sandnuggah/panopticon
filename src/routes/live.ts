import { createFileRoute } from '@tanstack/react-router'
import { liveResponse } from '../server/live.server'

export const Route = createFileRoute('/live')({
  server: {
    handlers: {
      GET: ({ request }) => liveResponse(request),
    },
  },
})
