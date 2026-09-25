import { useState, type FormEvent } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { getUser, loginWithPassword } from '../server/auth.functions'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await getUser()) throw redirect({ to: '/' })
  },
  head: () => ({ meta: [{ title: 'Sign in · panopticon' }] }),
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
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

  return (
    <main className="login">
      <h1>panopticon</h1>
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
