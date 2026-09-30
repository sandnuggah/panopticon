import { getRequest } from '@tanstack/react-start/server'
import { env } from './env.server'

// Security headers for every response. The Content-Security-Policy only allows scripts from this
// origin plus the inline scripts TanStack Start writes into each page, which carry a per-request
// nonce (see getRouter). Dev skips the CSP: Vite's dev server injects its own inline scripts.

const nonces = new WeakMap<Request, string>()

/** The current request's CSP nonce, created on first use. */
export function requestNonce(): string {
  const request = getRequest()
  let nonce = nonces.get(request)
  if (!nonce) {
    nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64')
    nonces.set(request, nonce)
  }
  return nonce
}

export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    // Keeps selected-asset URLs out of requests to the map tile server.
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Geolocation only for this site itself: "Show my position" on the map.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
    // Nothing here is for search engines, least of all live location links (/s/<link>).
    'X-Robots-Tag': 'noindex, nofollow',
  }
  if (!import.meta.env.DEV) headers['Content-Security-Policy'] = contentSecurityPolicy(requestNonce())
  return headers
}

function contentSecurityPolicy(nonce: string): string {
  const map = env().mapOrigins.join(' ')
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    `img-src 'self' data: blob: ${map}`,
    `connect-src 'self' ${map}`,
    "font-src 'self'",
    // maplibre's worker is bundled and served from this origin (see AssetMap.tsx).
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
