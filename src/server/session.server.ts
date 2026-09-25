import { redirect } from '@tanstack/react-router'
import { useSession } from '@tanstack/react-start/server'
import { env } from './env.server'
import { exchangeSessionForToken, revokeToken, TraccarError, type TraccarUser } from './traccar.server'

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
  const session = await appSession()
  const { token, expiresAt, name } = session.data
  if (!token || !expiresAt || expiresAt <= Date.now()) return null
  return { name: name ?? '' }
}

/**
 * Runs a Traccar call with the signed-in user's token. Redirects to /login when there is
 * no valid token, including when Traccar rejects it (expired or revoked).
 */
export async function withToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const session = await appSession()
  const { token, expiresAt } = session.data
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    throw redirect({ to: '/login' })
  }
  try {
    return await call(token)
  } catch (error) {
    if (error instanceof TraccarError && error.status === 401) {
      await session.clear()
      throw redirect({ to: '/login' })
    }
    throw error
  }
}
