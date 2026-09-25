import { useState, type FormEvent } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { editErrorMessage } from '../lib/editErrors'
import { getUser } from '../server/auth.functions'
import { addAsset, getManagedAssets } from '../server/manage.functions'

export const Route = createFileRoute('/assets/new')({
  beforeLoad: async () => {
    if (!(await getUser())) throw redirect({ to: '/login' })
  },
  loader: async () => (await getManagedAssets()).access,
  head: () => ({ meta: [{ title: 'Add asset · Panopticon' }] }),
  component: NewAssetPage,
})

function NewAssetPage() {
  const access = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await addAsset({
        data: { name: String(form.get('name') ?? ''), trackerId: String(form.get('trackerId') ?? '') },
      })
      if (result.ok) {
        // On to the new asset, where a photo can be added.
        await router.navigate({ to: '/assets/$id', params: { id: String(result.id) }, replace: true })
      } else {
        setError(editErrorMessage(result.error))
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="page settings">
      <header className="settings-header">
        <Link to="/assets" className="button-quiet">
          ← Assets
        </Link>
        <h1>Add asset</h1>
      </header>

      {access.canAdd ? (
        <form className="manage-form" method="post" onSubmit={onSubmit}>
          <label className="field">
            Name
            <input name="name" required maxLength={128} autoComplete="off" />
          </label>
          <label className="field">
            Tracker ID
            <input
              name="trackerId"
              required
              maxLength={128}
              pattern="[!-~]+"
              aria-describedby="tracker-id-hint"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <p id="tracker-id-hint" className="muted hint">
            The ID the tracker reports to Traccar, usually its IMEI, without spaces. It's often on a label on the tracker, or in its
            manual. The tracker also needs to be set up to send its position to your Traccar server.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add asset'}
          </button>
        </form>
      ) : (
        <p className="muted">
          Your Traccar account can't add assets, or has reached its limit. An administrator can change that in Traccar.
        </p>
      )}
    </main>
  )
}
