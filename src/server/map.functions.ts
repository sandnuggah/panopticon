import { createServerFn } from '@tanstack/react-start'
import { env } from './env.server'

/** The maplibre style URL. Not secret; it lives in env so it can point at a self-hosted tile server. */
export const getMapStyleUrl = createServerFn({ method: 'GET' }).handler(() => env().mapStyleUrl)
