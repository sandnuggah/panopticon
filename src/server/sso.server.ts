import { env } from './env.server'
import { rememberSsoState, signIn, takeSsoState } from './session.server'
import { endSession, finishOpenIdLogin, getTraccarSessionUser, startOpenIdLogin } from './traccar.server'

// SSO goes through Traccar's own OpenID Connect setup, so the identity provider is configured in one
// place. Traccar builds its redirect URI from `web.url`, which must therefore point at this app.

export type SsoError = 'sso-unavailable' | 'sso-failed' | 'sso-no-account' | 'sso-not-allowed'

/** GET /auth/sso: asks Traccar where to send the browser and remembers the state. */
export async function startSso(): Promise<Response> {
  try {
    const providerUrl = await startOpenIdLogin()
    const state = new URL(providerUrl).searchParams.get('state')
    if (!state) throw new Error('Traccar sent no OpenID state')
    await rememberSsoState(state)
    return redirect(providerUrl)
  } catch (error) {
    console.error('SSO start failed:', error instanceof Error ? error.message : error)
    return loginWithError('sso-unavailable')
  }
}

/** GET /api/session/openid/callback: the identity provider sends the browser back here. */
export async function finishSso(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const expectedState = await takeSsoState()
  if (!expectedState || url.searchParams.get('state') !== expectedState) {
    // Not started from this browser, started too long ago, or a replay.
    return loginWithError('sso-failed')
  }

  const query = new URLSearchParams(url.search)
  // Traccar treats redirect_uri here as a Traccar Manager (mobile app) override; we never need it.
  query.delete('redirect_uri')

  let sessionCookie: string | undefined
  try {
    const result = await finishOpenIdLogin(query)
    if (result.kind === 'refused') {
      console.warn('Traccar refused SSO sign-in:', result.reason)
      return loginWithError(errorFor(result.reason))
    }
    sessionCookie = result.sessionCookie
    const user = await getTraccarSessionUser(sessionCookie)
    await signIn(sessionCookie, user)
    return redirect('/')
  } catch (error) {
    console.error('SSO callback failed:', error instanceof Error ? error.message : error)
    if (sessionCookie) await endSession(sessionCookie)
    return loginWithError('sso-failed')
  }
}

/** Traccar UI paths that its emails link to (via `web.url`). Everything else stays a 404 here. */
const TRACCAR_UI_PATHS = ['/event/', '/settings/', '/reset-password', '/reports/', '/api/media/']

/** Catch-all: sends links from Traccar's emails on to Traccar, or returns null for a normal 404. */
export function traccarLinkRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  if (!TRACCAR_UI_PATHS.some((prefix) => url.pathname.startsWith(prefix))) return null
  // String concatenation, not new URL(path, base): a path like //evil.example must stay on Traccar.
  return redirect(env().traccarPublicUrl + url.pathname + url.search)
}

function errorFor(reason: string): SsoError {
  if (reason.includes('Registration disabled')) return 'sso-no-account'
  if (reason.includes('do not permit access')) return 'sso-not-allowed'
  return 'sso-failed'
}

function loginWithError(error: SsoError): Response {
  return redirect(`/login?error=${error}`)
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } })
}
