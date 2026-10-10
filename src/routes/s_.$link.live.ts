import { createFileRoute } from '@tanstack/react-router'
import { sharedLiveResponse } from '../server/liveLinks.server'

// Not nested under the /s/$link page (the trailing underscore), so it's a plain server route.
export const Route = createFileRoute('/s_/$link/live')({
  server: {
    handlers: {
      GET: ({ request, params }) => sharedLiveResponse(request, params.link),
    },
  },
})
