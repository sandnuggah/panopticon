import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Block, BlockFooter, BlockTitle, Button, Dialog, DialogButton, List, ListButton, ListInput, ListItem } from 'konsta/react'
import { prepareAssetImage } from '../lib/assetImage'
import { editErrorMessage } from '../lib/editErrors'
import { getManagedAsset, removeAsset, removeAssetImage, renameAsset, uploadAssetImage } from '../server/manage.functions'
import type { EditResult } from '../server/manage.server'
import { AssetAvatar } from './AssetAvatar'
import { TrackerSection } from './TrackerDetails'

type Loaded = Awaited<ReturnType<typeof getManagedAsset>>

/** What a section is doing: nothing, working, or done with a message. */
type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

const IDLE: Status = { kind: 'idle' }

type Props = {
  id: number
  listColors?: { strongBgIos: string }
  /** Called once the asset is removed, to go back to the list. */
  onRemoved: () => void
}

/** One asset: its photo, name, how its tracker is doing, and removing it. */
export function AssetEditor({ id, listColors, onRemoved }: Props) {
  const router = useRouter()
  const [data, setData] = useState<Loaded | undefined>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [photo, setPhoto] = useState<Status>(IDLE)
  const [name, setName] = useState<Status>(IDLE)
  const [removal, setRemoval] = useState<Status>(IDLE)
  const [confirming, setConfirming] = useState(false)

  async function load() {
    try {
      setData(await getManagedAsset({ data: { id } }))
    } catch {
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  if (data === undefined) {
    return (
      <List strong inset colors={listColors}>
        <ListItem title={loadFailed ? "Couldn't load the asset. Try again." : 'Loading…'} />
      </List>
    )
  }
  if (data === null) {
    return <BlockFooter>This asset may have been removed, or your account can't see it.</BlockFooter>
  }

  const { asset, access } = data

  /** Runs a change, then reloads this asset and the map, so the avatar, name and markers pick it up. */
  async function change(setStatus: (status: Status) => void, run: () => Promise<EditResult>, done: string) {
    setStatus({ kind: 'busy' })
    try {
      const result = await run()
      if (!result.ok) return setStatus({ kind: 'error', message: editErrorMessage(result.error) })
      await Promise.all([load(), router.invalidate()])
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
      void router.invalidate()
      onRemoved()
    } catch {
      setRemoval({ kind: 'error', message: 'Something went wrong. Try again.' })
    }
  }

  return (
    <>
      <Block className="mt-2! flex flex-col items-center gap-3">
        <AssetAvatar asset={asset} size="large" />
        {access.canEdit && (
          <div className="flex gap-2">
            <Button component="label" small rounded tonal className={`w-auto! px-3 ${photo.kind === 'busy' ? 'opacity-50' : ''}`}>
              {asset.imageUrl ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" className="sr-only" disabled={photo.kind === 'busy'} onChange={onPhotoChosen} />
            </Button>
            {asset.imageUrl && (
              <Button
                small
                rounded
                tonal
                className="w-auto! px-3"
                disabled={photo.kind === 'busy'}
                onClick={() => change(setPhoto, () => removeAssetImage({ data: { id: asset.id } }), 'Photo removed.')}
              >
                Remove photo
              </Button>
            )}
          </div>
        )}
        <StatusMessage status={photo} busy="Uploading…" />
      </Block>

      {access.canEdit && (
        // Keyed so a saved or reloaded name resets the field.
        <form key={asset.name} onSubmit={onRename}>
          <BlockTitle>Name</BlockTitle>
          <List strong inset colors={listColors}>
            <ListInput name="name" defaultValue={asset.name} required maxLength={128} autoComplete="off" aria-label="Name" />
          </List>
          <Block className="flex items-center gap-3">
            <Button rounded className="w-auto! px-5" type="submit" disabled={name.kind === 'busy'}>
              Save
            </Button>
            <StatusMessage status={name} busy="Saving…" />
          </Block>
        </form>
      )}

      <TrackerSection assetId={asset.id} listColors={listColors} />

      {access.canEdit ? (
        <>
          <List strong inset colors={listColors}>
            <ListButton colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }} onClick={() => setConfirming(true)}>
              Remove asset…
            </ListButton>
          </List>
          <BlockFooter>Removes {asset.name} from Traccar, including its settings and photo. This can't be undone.</BlockFooter>
          <StatusMessage status={removal} busy="Removing…" />
        </>
      ) : (
        <BlockFooter>Your Traccar account can't change assets. An administrator can allow it in Traccar.</BlockFooter>
      )}
      <Dialog
        opened={confirming}
        onBackdropClick={() => setConfirming(false)}
        title={`Remove ${asset.name}?`}
        content="It's removed from Traccar with its settings and photo. This can't be undone."
        buttons={
          <>
            <DialogButton onClick={() => setConfirming(false)}>Cancel</DialogButton>
            <DialogButton
              strong
              className="text-red-500"
              onClick={() => {
                setConfirming(false)
                void onRemove()
              }}
            >
              Remove
            </DialogButton>
          </>
        }
      />
    </>
  )
}

function StatusMessage({ status, busy }: { status: Status; busy: string }) {
  if (status.kind === 'error') {
    return (
      <p className="px-4 text-sm text-red-500" role="alert">
        {status.message}
      </p>
    )
  }
  const text = status.kind === 'busy' ? busy : status.kind === 'done' ? status.message : ''
  return (
    <p className="px-4 text-sm opacity-60" role="status">
      {text}
    </p>
  )
}
