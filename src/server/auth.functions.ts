import { createServerFn } from '@tanstack/react-start'
import { getSessionUser, signIn, signOut } from './session.server'
import { createPasswordSession, getServerInfo, TraccarError } from './traccar.server'

export type LoginResult = { ok: true } | { ok: false; error: 'invalid' | 'code-required' | 'unavailable' }

export const getUser = createServerFn({ method: 'GET' }).handler(() => getSessionUser())

/** Whether to offer SSO on the login page. False if Traccar is unreachable; password sign-in then reports it. */
export const getLoginOptions = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { openIdEnabled } = await getServerInfo()
    return { sso: openIdEnabled }
  } catch (error) {
    console.warn('Could not read Traccar server info:', error instanceof Error ? error.message : error)
    return { sso: false }
  }
})

export const loginWithPassword = createServerFn({ method: 'POST' })
  .validator(parseLoginInput)
  .handler(async ({ data }): Promise<LoginResult> => {
    try {
      const result = await createPasswordSession(data.email, data.password, data.code)
      if (result.kind !== 'ok') {
        return { ok: false, error: result.kind }
      }
      await signIn(result.sessionCookie, result.user)
      return { ok: true }
    } catch (error) {
      if (error instanceof TraccarError) {
        console.error('Password sign-in failed:', error.message)
        return { ok: false, error: 'unavailable' }
      }
      throw error
    }
  })

export const logout = createServerFn({ method: 'POST' }).handler(() => signOut())

function parseLoginInput(input: unknown): { email: string; password: string; code?: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid sign-in request')
  const { email, password, code } = input as Record<string, unknown>
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid sign-in request')
  }
  if (!email.trim() || email.length > 320 || !password || password.length > 1024) {
    throw new Error('Invalid sign-in request')
  }
  if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) {
    throw new Error('Invalid sign-in request')
  }
  return { email: email.trim(), password, code }
}
