import { createFileRoute } from '@tanstack/react-router'
import { assetImageResponse } from '../server/images.server'

export const Route = createFileRoute('/images/asset/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) => assetImageResponse(request, params.id),
    },
  },
})
