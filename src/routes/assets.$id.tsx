import { useState, type ChangeEvent, type FormEvent } from 'react'
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { AssetAvatar } from '../components/AssetAvatar'
import { TrackerSection } from '../components/TrackerDetails'
import { prepareAssetImage } from '../lib/assetImage'
import { editErrorMessage } from '../lib/editErrors'
import { getUser } from '../server/auth.functions'
import { getManagedAsset, removeAsset, removeAssetImage, renameAsset, uploadAssetImage } from '../server/manage.functions'
import type { EditResult } from '../server/manage.server'

export const Route = createFileRoute('/assets/$id')({
  beforeLoad: async () => {
    if (!(await getUser())) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => {
    const id = Number(params.id)
    return Number.isInteger(id) && id > 0 ? getManagedAsset({ data: { id } }) : null
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.asset.name ?? 'Asset'} · Panopticon` }],
  }),
  component: AssetPage,
})

/** What a section is doing: nothing, working, or done with a message. */
type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

const IDLE: Status = { kind: 'idle' }

function AssetPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [photo, setPhoto] = useState<Status>(IDLE)
  const [name, setName] = useState<Status>(IDLE)
  const [removal, setRemoval] = useState<Status>(IDLE)
  const [confirming, setConfirming] = useState(false)

  if (!data) {
    return (
      <main className="page settings">
        <header className="settings-header">
          <Link to="/assets" className="button-quiet">
            ← Assets
          </Link>
          <h1>Asset not found</h1>
        </header>
        <p className="muted">It may have been removed, or your account can't see it.</p>
      </main>
    )
  }

  const { asset, access } = data

  /** Runs a change, then reloads the page data so the avatar, name and map pick it up. */
  async function change(setStatus: (status: Status) => void, run: () => Promise<EditResult>, done: string) {
    setStatus({ kind: 'busy' })
    try {
      const result = await run()
      if (!result.ok) return setStatus({ kind: 'error', message: editErrorMessage(result.error) })
      await router.invalidate()
      setStatus({ kind: 'done', message: done })
    } catch {
      setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
    }
  }

  async function onPhotoChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear it so picking the same file again still counts as a change.
    event.target.value = ''
    if (!file) return
    setPhoto({ kind: 'busy' })
    let image: Blob
    try {
      image = await prepareAssetImage(file)
    } catch {
      return setPhoto({ kind: 'error', message: "Couldn't read that image. Try a JPEG or PNG photo." })
    }
    const form = new FormData()
    form.set('id', String(asset.id))
    form.set('image', image, 'photo.jpg')
    await change(setPhoto, () => uploadAssetImage({ data: form }), 'Photo updated.')
  }

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const newName = String(new FormData(event.currentTarget).get('name') ?? '')
    await change(setName, () => renameAsset({ data: { id: asset.id, name: newName } }), 'Name saved.')
  }

  async function onRemove() {
    setRemoval({ kind: 'busy' })
    try {
      const result = await removeAsset({ data: { id: asset.id } })
      if (!result.ok) return setRemoval({ kind: 'error', message: editErrorMessage(result.error) })
      await router.navigate({ to: '/assets', replace: true })
    } catch {
      setRemoval({ kind: 'error', message: 'Something went wrong. Try again.' })
    }
  }

  return (
    <main className="page settings">
      <header className="settings-header">
        <Link to="/assets" className="button-quiet">
          ← Assets
        </Link>
        <h1>{asset.name}</h1>
      </header>

      <TrackerSection assetId={asset.id} />

      {!access.canEdit ? (
        <p className="muted">Your Traccar account can't change assets. An administrator can allow it in Traccar.</p>
      ) : (
        <>
          <section>
            <h2>Photo</h2>
            <div className="asset-photo">
              <AssetAvatar asset={asset} />
              <div className="button-row">
                <label className={`button-quiet file-button${photo.kind === 'busy' ? ' is-busy' : ''}`}>
                  {asset.imageUrl ? 'Change photo' : 'Add photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="visually-hidden"
                    disabled={photo.kind === 'busy'}
                    onChange={onPhotoChosen}
                  />
                </label>
                {asset.imageUrl && (
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={photo.kind === 'busy'}
                    onClick={() => change(setPhoto, () => removeAssetImage({ data: { id: asset.id } }), 'Photo removed.')}
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            <StatusMessage status={photo} busy="Uploading…" />
          </section>

          <section>
            <h2>Name</h2>
            {/* Keyed so a saved or reloaded name resets the field. */}
            <form key={asset.name} className="manage-form manage-form-inline" onSubmit={onRename}>
              <label className="field">
                <span className="visually-hidden">Name</span>
                <input name="name" defaultValue={asset.name} required maxLength={128} autoComplete="off" />
              </label>
              <button type="submit" disabled={name.kind === 'busy'}>
                Save
              </button>
            </form>
            <StatusMessage status={name} busy="Saving…" />
          </section>

          <section>
            <h2>Remove</h2>
            <p className="muted hint">
              Removes {asset.name} from Traccar, including its settings and photo. This can't be undone.
            </p>
            {confirming ? (
              <div className="button-row">
                <button type="button" className="button-danger" disabled={removal.kind === 'busy'} onClick={onRemove}>
                  {removal.kind === 'busy' ? 'Removing…' : `Yes, remove ${asset.name}`}
                </button>
                <button type="button" className="button-quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="button-danger" onClick={() => setConfirming(true)}>
                Remove asset…
              </button>
            )}
            <StatusMessage status={removal} busy="" />
          </section>
        </>
      )}
    </main>
  )
}

function StatusMessage({ status, busy }: { status: Status; busy: string }) {
  if (status.kind === 'error') {
    return (
      <p className="error" role="alert">
        {status.message}
      </p>
    )
  }
  const text = status.kind === 'busy' ? busy : status.kind === 'done' ? status.message : ''
  return (
    <p className="muted hint" role="status">
      {text}
    </p>
  )
}
