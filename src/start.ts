import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { securityHeaders } from './server/security.server'

// With a start.ts, Start no longer adds its default CSRF protection for server functions,
// so it's registered here explicitly.
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const security = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  const result = await next()
  const headers = securityHeaders()
  try {
    for (const [name, value] of Object.entries(headers)) result.response.headers.set(name, value)
    return result
  } catch {
    // Some responses have immutable headers; copy those.
    const response = new Response(result.response.body, result.response)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return { ...result, response }
  }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, security],
}))
