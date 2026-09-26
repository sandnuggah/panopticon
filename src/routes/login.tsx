import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { getLoginOptions, getUser, loginWithPassword } from '../server/auth.functions'
import { appName, useTheme } from '../lib/theme'
import type { SsoError } from '../server/sso.server'

const ssoMessages: Record<SsoError, string> = {
  'sso-unavailable': "Single sign-on isn't available right now. Try again, or sign in with your password.",
  'sso-failed': "Single sign-on didn't complete. Try again.",
  'sso-no-account': 'No Traccar account uses the email from your sign-in provider.',
  'sso-not-allowed': "Your sign-in provider account isn't in a group allowed to use Traccar.",
}

type Search = { error?: SsoError }

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.error === 'string' && search.error in ssoMessages ? { error: search.error as SsoError } : {},
  beforeLoad: async () => {
    if (await getUser()) throw redirect({ to: '/' })
  },
  loader: () => getLoginOptions(),
  head: ({ match }) => ({ meta: [{ title: `Sign in · ${appName(match.context.theme)}` }] }),
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const { sso } = Route.useLoaderData()
  const { error: ssoError } = Route.useSearch()
  const [theme] = useTheme()
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await loginWithPassword({
        data: {
          email: String(form.get('email') ?? ''),
          password: String(form.get('password') ?? ''),
          code: needsCode ? String(form.get('code') ?? '') : undefined,
        },
      })
      if (result.ok) {
        await router.navigate({ to: '/' })
      } else if (result.error === 'code-required') {
        setNeedsCode(true)
      } else if (result.error === 'invalid') {
        setError(needsCode ? 'Wrong password or code.' : 'Wrong email or password.')
      } else {
        setError("Can't reach the Traccar server. Try again in a moment.")
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  const shownError = error ?? (ssoError ? ssoMessages[ssoError] : null)

  return (
    <main className="login">
      <h1>{appName(theme)}</h1>
      {sso && (
        <>
          {/* A full page load, not client routing: /auth/sso redirects to the identity provider. */}
          <a className="button-primary" href="/auth/sso">
            Sign in with SSO
          </a>
          <p className="divider">or with your Traccar password</p>
        </>
      )}
      {/* method="post" keeps credentials out of the URL if someone submits before hydration */}
      <form method="post" onSubmit={onSubmit}>
        <label>
          Email
          <input name="email" type="text" autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {needsCode && (
          <label>
            Code from your authenticator app
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
            />
          </label>
        )}
        {shownError && (
          <p className="error" role="alert">
            {shownError}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
