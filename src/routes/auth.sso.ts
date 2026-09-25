import { createFileRoute } from '@tanstack/react-router'
import { startSso } from '../server/sso.server'

export const Route = createFileRoute('/auth/sso')({
  server: {
    handlers: {
      GET: () => startSso(),
    },
  },
})
