import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Block, BlockFooter, BlockTitle, Button, Dialog, DialogButton, List, ListButton, ListInput, ListItem, Toggle } from 'konsta/react'
import { prepareAssetImage } from '../lib/assetImage'
import { editErrorMessage } from '../lib/editErrors'
import { TRAIL_OPTIONS, trailLabel, trailOptionsOf, type TrailOptions } from '../lib/trail'
import { DEFAULT_TRAIL_COLOR, TRAIL_COLORS } from '../lib/trailColors'
import {
  getManagedAsset,
  removeAsset,
  removeAssetImage,
  renameAsset,
  setAssetTrailColor,
  setAssetTrailOptions,
  uploadAssetImage,
} from '../server/manage.functions'
import type { EditResult } from '../server/manage.server'
import { AssetAlerts } from './AssetAlerts'
import { AssetAvatar } from './AssetAvatar'
import { CheckIcon } from './icons'
import { TrailSwatch } from './TrailSwatch'
import { TrackerSection } from './TrackerSection'

type Loaded = Awaited<ReturnType<typeof getManagedAsset>>

/** What a section is doing: nothing, working, or done with a message. */
type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

const IDLE: Status = { kind: 'idle' }

type Props = {
  id: number
  listColors?: { strongBgIos: string }
  /** Whether the server has map matching (MAP_MATCHING_URL), so Snap to paths can be turned on. */
  canSnapToPaths: boolean
  /** Called once the asset is removed, to go back to the list. */
  onRemoved: () => void
}

/** One asset: its photo, name, its trail (colour, length, how walks are drawn), how its tracker is doing, and removing it. */
export function AssetEditor({ id, listColors, canSnapToPaths, onRemoved }: Props) {
  const router = useRouter()
  const [data, setData] = useState<Loaded | undefined>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [photo, setPhoto] = useState<Status>(IDLE)
  const [name, setName] = useState<Status>(IDLE)
  const [color, setColor] = useState<Status>(IDLE)
  // The trail's length, and how walks are drawn, each with its own message under its list.
  const [lengthStatus, setLengthStatus] = useState<Status>(IDLE)
  const [walksStatus, setWalksStatus] = useState<Status>(IDLE)
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
  const trail = trailOptionsOf(asset)

  /** Saves a change to how its trail is drawn, one at a time. */
  function saveTrail(options: Partial<TrailOptions>) {
    if (lengthStatus.kind === 'busy' || walksStatus.kind === 'busy') return
    const onOff = (on: boolean | undefined) => (on ? 'on' : 'off')
    const save = () => setAssetTrailOptions({ data: { id: asset.id, ...options } })
    if (options.length !== undefined) return void change(setLengthStatus, save, 'Trail saved.')
    const done =
      options.pawPrints !== undefined ? `Paw prints ${onOff(options.pawPrints)}.` : `Snap to paths ${onOff(options.snapToPaths)}.`
    void change(setWalksStatus, save, done)
  }

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

      {access.canEdit && (
        <>
          <BlockTitle>Trail colour</BlockTitle>
          <List strong inset colors={listColors}>
            {TRAIL_COLORS.map((option) => (
              <ListItem
                key={option.id}
                link
                chevron={false}
                media={<TrailSwatch day={option.day} night={option.night} />}
                title={option.name}
                after={option.id === (asset.trailColor ?? DEFAULT_TRAIL_COLOR) && <CheckIcon />}
                onClick={() =>
                  color.kind !== 'busy' &&
                  change(setColor, () => setAssetTrailColor({ data: { id: asset.id, color: option.id } }), 'Trail colour saved.')
                }
              />
            ))}
          </List>
          <BlockFooter>
            <div>
              Its trail on the map, for everyone who can see {asset.name}, in a lighter shade on a dark map.
              <FooterStatus status={color} busy="Saving…" />
            </div>
          </BlockFooter>

          <BlockTitle>Trail</BlockTitle>
          <List strong inset colors={listColors}>
            {TRAIL_OPTIONS.map((length) => (
              <ListItem
                key={length}
                link
                chevron={false}
                title={trailLabel(length)}
                after={length === trail.length && <CheckIcon />}
                onClick={() => saveTrail({ length })}
              />
            ))}
          </List>
          <BlockFooter>
            <div>
              How much of its recent movement the map draws. This outing is the walk under way, or the last one: since it left home, daycare
              or anywhere it stayed 20 minutes or more. Today is everything since midnight.
              <FooterStatus status={lengthStatus} busy="Saving…" />
            </div>
          </BlockFooter>

          <BlockTitle>Walks</BlockTitle>
          <List strong inset colors={listColors}>
            <ListItem
              title="Paw prints"
              after={<Toggle checked={trail.pawPrints} onChange={() => saveTrail({ pawPrints: !trail.pawPrints })} />}
            />
            {/* Greyed out without a map-matching server (MAP_MATCHING_URL), which does the snapping. */}
            <ListItem
              title="Snap to paths"
              className={canSnapToPaths ? undefined : 'opacity-50'}
              after={
                <Toggle
                  checked={canSnapToPaths && trail.snapToPaths}
                  disabled={!canSnapToPaths}
                  onChange={() => saveTrail({ snapToPaths: !trail.snapToPaths })}
                />
              }
            />
          </List>
          <BlockFooter>
            <div>
              Paw prints draws its walks as a dog's tracks close up, instead of a line.{' '}
              {canSnapToPaths
                ? 'Snap to paths draws them along the streets and paths it most likely took, instead of straight lines between GPS fixes.'
                : "Snap to paths draws them along the streets and paths it most likely took, but needs a map-matching server, which this one doesn't have (MAP_MATCHING_URL)."}{' '}
              For everyone who can see {asset.name}.
              <FooterStatus status={walksStatus} busy="Saving…" />
            </div>
          </BlockFooter>
        </>
      )}

      <AssetAlerts assetId={asset.id} listColors={listColors} />

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

/**
 * The same, as a line of its own at the end of a list's footer, inside a block with the footer's text
 * (the footer lays its children out in a row): Konsta pulls a footer up against its list, so a
 * message put between them was drawn over the footer's text.
 */
function FooterStatus({ status, busy }: { status: Status; busy: string }) {
  const text = status.kind === 'busy' ? busy : status.kind === 'done' || status.kind === 'error' ? status.message : ''
  // Always there, empty until there's news, so screen readers hear it when it comes.
  return (
    <span role="status" className={text ? `mt-1 block ${status.kind === 'error' ? 'text-red-500' : 'font-semibold'}` : undefined}>
      {text}
    </span>
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
