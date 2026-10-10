import { createServerFn } from '@tanstack/react-start'
import { env } from './env.server'
import { getSessionUser, signIn, signOut } from './session.server'
import { createPasswordSession, getServerInfo, TraccarError } from './traccar.server'

export type LoginResult = { ok: true } | { ok: false; error: 'invalid' | 'code-required' | 'unavailable' | 'turned-off' }

export const getUser = createServerFn({ method: 'GET' }).handler(() => getSessionUser())

/**
 * The sign-in methods the page offers: those SIGN_IN_METHODS allows, SSO only when Traccar has
 * OpenID set up, and passwords not when Traccar forces OpenID (it refuses them then). `ssoMissing`:
 * SSO is the only method allowed but Traccar can't do it right now.
 */
export const getLoginOptions = createServerFn({ method: 'GET' }).handler(async () => {
  const allowed = env().signInMethods
  let openIdEnabled = false
  let openIdForce = false
  try {
    ;({ openIdEnabled, openIdForce } = await getServerInfo())
  } catch (error) {
    // Unreachable: offer what's allowed; password sign-in then reports it.
    console.warn('Could not read Traccar server info:', error instanceof Error ? error.message : error)
  }
  const sso = allowed.sso && openIdEnabled
  const password = allowed.password && !(openIdForce && sso)
  return { sso, password, ssoMissing: allowed.sso && !sso && !password }
})

export const loginWithPassword = createServerFn({ method: 'POST' })
  .validator(parseLoginInput)
  .handler(async ({ data }): Promise<LoginResult> => {
    if (!env().signInMethods.password) return { ok: false, error: 'turned-off' }
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
