import { createFileRoute } from '@tanstack/react-router'
import { sharedImageResponse } from '../server/sharing.server'

export const Route = createFileRoute('/s_/$link/image')({
  server: {
    handlers: {
      GET: ({ request, params }) => sharedImageResponse(request, params.link),
    },
  },
})
