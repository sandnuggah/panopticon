// Production server: serves the built client files and hands everything else to the
// TanStack Start handler. Run `npm run build` first. Config comes from the environment
// (see .env.example); `npm start` also reads .env if present.
import { serve } from 'srvx'
import { serveStatic } from 'srvx/static'
import app from './dist/server/server.js'

const staticFiles = serveStatic({ dir: new URL('./dist/client', import.meta.url).pathname })

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  fetch: app.fetch,
  gracefulShutdown: true,
  middleware: [
    async (request, next) => {
      const response = await staticFiles(request, next)
      const { pathname } = new URL(request.url)
      // Files in /assets/ have content hashes in their names, so they never change.
      if (response.ok && pathname.startsWith('/assets/')) {
        response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      }
      // srvx doesn't know this type.
      if (response.ok && pathname.endsWith('.webmanifest')) {
        response.headers.set('Content-Type', 'application/manifest+json')
      }
      return response
    },
  ],
})
