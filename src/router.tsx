import { createRouter, Link } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { routeTree } from './routeTree.gen'
import { requestNonce } from './server/security.server'

// On the server, the inline scripts Start writes into the page need the request's CSP nonce.
const scriptNonce = createIsomorphicFn()
  .server(() => requestNonce())
  .client(() => undefined)

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultNotFoundComponent: NotFound,
    ssr: { nonce: scriptNonce() },
  })
}

function NotFound() {
  return (
    <main className="page">
      <p>Page not found.</p>
      <Link to="/">Back to your assets</Link>
    </main>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
