import { getRequestHeader } from '@tanstack/react-start/server'
import { platformFor, type Platform } from '../lib/platform'

/** iOS or Material, from the request's User-Agent. */
export function requestPlatform(): Platform {
  return platformFor(getRequestHeader('user-agent') ?? '')
}
