import { createServerFn } from '@tanstack/react-start'
import { loadPets } from './pets.server'
import { withToken } from './session.server'

export const getPets = createServerFn({ method: 'GET' }).handler(() => withToken(loadPets))
