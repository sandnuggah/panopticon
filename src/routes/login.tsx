import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Block, BlockTitle, Button, List, ListInput, Page } from 'konsta/react'
import { getLoginOptions, getUser, loginWithPassword } from '../server/auth.functions'
import type { SsoError } from '../server/sso.server'
import { BackIcon } from '../components/icons'

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
  head: () => ({ meta: [{ title: 'Sign in · Panopticon' }] }),
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const { sso, password, ssoMissing } = Route.useLoaderData()
  const { error: ssoError } = Route.useSearch()
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
      } else if (result.error === 'turned-off') {
        setError('Signing in with a password is turned off on this server.')
      } else {
        setError("Can't reach the Traccar server. Try again in a moment.")
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  const shownError =
    error ?? (ssoError ? ssoMessages[ssoError] : ssoMissing ? "Single sign-on isn't available right now. Try again in a moment." : null)
  const errorMessage = shownError && (
    <p className="px-8 text-sm text-red-500" role="alert">
      {shownError}
    </p>
  )

  return (
    <Page>
      <div className="mx-auto max-w-md pb-8 pt-[max(24px,calc(env(safe-area-inset-top)+12px))]">
        <a href="/welcome" className="inline-flex items-center gap-0.5 px-3 text-[1.0625rem] text-primary active:opacity-50">
          <BackIcon />
          Panopticon
        </a>
        <h1 className="paper-title px-4 pt-4 pb-2 text-center text-[calc(1rem+26px)] leading-tight">Sign in</h1>
        {sso && (
          <>
            <Block>
              {/* A full page load, not client routing: /auth/sso redirects to the identity provider. */}
              <Button large rounded href="/auth/sso">
                Sign in with SSO
              </Button>
            </Block>
            {password && (
              // Lined up with the fields' labels, as iOS's section headers are.
              <BlockTitle className="mt-6! px-8! text-[0.9375rem]! font-medium! opacity-60">Or with your Traccar password</BlockTitle>
            )}
          </>
        )}
        {!password && errorMessage}
        {/* Which methods show is SIGN_IN_METHODS on the server (see getLoginOptions). method="post"
            keeps credentials out of the URL if someone submits before hydration. */}
        {password && (
          <form method="post" onSubmit={onSubmit}>
            <List strong inset className={sso ? 'mt-4!' : undefined}>
              <ListInput label="Email" name="email" type="text" autoComplete="username" autoCapitalize="none" required />
              <ListInput label="Password" name="password" type="password" autoComplete="current-password" required />
              {needsCode && (
                <ListInput
                  label="Code from your authenticator app"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              )}
            </List>
            {errorMessage}
            <Block>
              <Button large rounded type="submit" disabled={pending}>
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
            </Block>
          </form>
        )}
      </div>
    </Page>
  )
}
