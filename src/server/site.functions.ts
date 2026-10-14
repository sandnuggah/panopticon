import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestHeader } from '@tanstack/react-start/server'

/**
 * Panopticon's address as visitors reach it, for absolute links such as the front page's link
 * preview picture: the reverse proxy's X-Forwarded-Proto and X-Forwarded-Host (or Host), else the
 * request's own. Caddy passes these on as they are; nginx needs `proxy_set_header Host $host`.
 */
export const getSiteOrigin = createServerFn({ method: 'GET' }).handler(() => siteOrigin())

function siteOrigin(): string {
  const url = new URL(getRequest().url)
  const proto = firstValue(getRequestHeader('x-forwarded-proto')) ?? url.protocol.replace(/:$/, '')
  const host = firstValue(getRequestHeader('x-forwarded-host')) ?? getRequestHeader('host') ?? url.host
  if (!/^https?$/.test(proto) || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return url.origin
  return `${proto}://${host}`
}

/** The first of a header's comma-separated values (a chain of proxies adds one each). */
function firstValue(header: string | undefined): string | undefined {
  return header?.split(',')[0]?.trim() || undefined
}
