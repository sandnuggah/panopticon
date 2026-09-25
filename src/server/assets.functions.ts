import { createServerFn } from '@tanstack/react-start'
import { loadAssets } from './assets.server'
import { withToken } from './session.server'

export const getAssets = createServerFn({ method: 'GET' }).handler(() => withToken(loadAssets))
