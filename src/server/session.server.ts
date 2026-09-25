import { redirect } from '@tanstack/react-router'
import { useSession } from '@tanstack/react-start/server'
import { env } from './env.server'
import { exchangeSessionForToken, revokeToken, tokenWasRejected, type TraccarUser } from './traccar.server'

// The app's only state: a sealed, httpOnly cookie holding the user's Traccar API token.

type SessionData = {
  token: string
  expiresAt: number
  name: string
}

export type SessionUser = { name: string }

function appSession() {
  const { sessionSecret, sessionDays } = env()
  return useSession<SessionData>({
    name: 'panopticon',
    password: sessionSecret,
    maxAge: sessionDays * 24 * 60 * 60,
    sessionHeader: false,
    cookie: {
      httpOnly: true,
      secure: !import.meta.env.DEV,
      sameSite: 'lax',
      path: '/',
    },
  })
}

/**
 * Short-lived cookie holding the OpenID `state` between /auth/sso and the callback. Traccar sends
 * a state but never checks it; checking it here stops a login-CSRF (being signed in as someone else).
 */
function ssoStateSession() {
  return useSession<{ state: string }>({
    name: 'panopticon-sso',
    password: env().sessionSecret,
    maxAge: 10 * 60,
    sessionHeader: false,
    cookie: {
      httpOnly: true,
      secure: !import.meta.env.DEV,
      // Lax still sends it on the identity provider's top-level redirect back to us.
      sameSite: 'lax',
      path: '/',
    },
  })
}

export async function rememberSsoState(state: string): Promise<void> {
  const session = await ssoStateSession()
  await session.update({ state })
}

/** Returns the remembered state and forgets it, so each state works once. */
export async function takeSsoState(): Promise<string | undefined> {
  const session = await ssoStateSession()
  const { state } = session.data
  await session.clear()
  return state
}

/** Finishes any sign-in: swaps the Traccar session for a token and stores it in the cookie. */
export async function signIn(traccarSessionCookie: string, user: TraccarUser): Promise<void> {
  const expiresAt = Date.now() + env().sessionDays * 24 * 60 * 60 * 1000
  const token = await exchangeSessionForToken(traccarSessionCookie, new Date(expiresAt))
  const session = await appSession()
  await session.update({ token, expiresAt, name: user.name || user.email })
}

export async function signOut(): Promise<void> {
  const session = await appSession()
  const { token } = session.data
  await session.clear()
  if (token) await revokeToken(token).catch(() => {})
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!(await getSessionToken())) return null
  const session = await appSession()
  return { name: session.data.name ?? '' }
}

/** The signed-in user's Traccar token, or null when signed out or expired. */
export async function getSessionToken(): Promise<string | null> {
  const session = await appSession()
  const { token, expiresAt } = session.data
  if (!token || !expiresAt || expiresAt <= Date.now()) return null
  return token
}

export async function clearSession(): Promise<void> {
  const session = await appSession()
  await session.clear()
}

/**
 * Runs a Traccar call with the signed-in user's token. Redirects to /login when there is
 * no valid token, including when Traccar rejects it (expired or revoked).
 */
export async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = await getSessionToken()
  if (!token) throw redirect({ to: '/login' })
  try {
    return await call(token)
  } catch (error) {
    if (await tokenWasRejected(token, error)) {
      await clearSession()
      throw redirect({ to: '/login' })
    }
    throw error
  }
}
