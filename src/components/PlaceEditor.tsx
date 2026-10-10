import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { BlockFooter, BlockTitle, Button, Dialog, DialogButton, List, ListButton, ListInput, ListItem, Range, Toggle } from 'konsta/react'
import { editErrorMessage } from '../lib/editErrors'
import { PLACE_RADII, radiusLabel, type Place } from '../lib/places'
import type { LatLon } from '../lib/segments'
import { getManagedAssets } from '../server/manage.functions'
import { deletePlace, savePlaceChange } from '../server/places.functions'
import type { EditResult } from '../server/manage.server'
import { CARD_BG, CloseButton, moveFocus, ROWS } from './cards'

type Managed = Awaited<ReturnType<typeof getManagedAssets>>

type Props = {
  /** The place to change, or null for a new one. */
  place: Place | null
  /** The circle's radius, shared with the map's picker. */
  radius: number
  onRadiusChange: (radius: number) => void
  /** The middle of the visible map, where the circle is (see PlacePicker). */
  center: LatLon | null
  /** How tall the card is, so the map can keep the circle in the part above it. */
  onHeight: (pixels: number) => void
  /** Back to the list of places, after saving, removing or cancelling. */
  onClose: () => void
}

/**
 * Adding or changing a place, in a card at the bottom of the map screen while the map above it
 * places the circle (PlacePicker): its name, size, and which assets it's for. Polygons drawn in
 * Traccar can be renamed and given to assets, but their shape is changed in Traccar.
 */
export function PlaceEditor({ place, radius, onRadiusChange, center, onHeight, onClose }: Props) {
  const router = useRouter()
  const card = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [managed, setManaged] = useState<Managed>()
  const [name, setName] = useState(place?.name ?? '')
  // A new place is for every asset to begin with; most people have one or two.
  const [assetIds, setAssetIds] = useState<number[] | null>(place?.assetIds ?? null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const [confirming, setConfirming] = useState(false)
  const circle = place === null || place.area.kind === 'circle'

  useEffect(() => {
    moveFocus(closeButton.current)
    let cancelled = false
    getManagedAssets()
      .then((result) => {
        if (cancelled) return
        setManaged(result)
        setAssetIds((ids) => ids ?? result.assets.filter((asset) => !asset.disabled).map((asset) => asset.id))
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: 'error', message: "Couldn't load the assets. Try again." })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The card's height, for the map; it changes with an error message or the text size.
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const report = () => onHeight(element.getBoundingClientRect().height + 8)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [onHeight])

  async function run(call: () => Promise<EditResult>) {
    setStatus({ kind: 'busy' })
    try {
      const result = await call()
      if (!result.ok) {
        const message = result.error === 'not-found' ? 'This place no longer exists in Traccar.' : editErrorMessage(result.error)
        return setStatus({ kind: 'error', message })
      }
      // Close first: once reloaded, a removed place is gone, which would close the editor a second time.
      onClose()
      await router.invalidate()
    } catch {
      setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
    }
  }

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return setStatus({ kind: 'error', message: 'Give the place a name.' })
    if (circle && !center) return
    void run(() =>
      savePlaceChange({
        data: {
          id: place?.id,
          name: trimmed,
          circle: circle && center ? { center, radius } : null,
          assetIds: assetIds ?? [],
        },
      }),
    )
  }

  const canEdit = managed?.access.canEdit === true
  const busy = status.kind === 'busy'
  // The slider moves through PLACE_RADII; a radius set elsewhere sits at the nearest step until moved.
  const step = nearestStep(radius)

  return (
    <section
      role="dialog"
      aria-label={place ? `Edit ${place.name}` : 'New place'}
      className="absolute inset-x-0 bottom-0 z-30 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))]"
    >
      <div ref={card} className={`relative max-h-[50dvh] overflow-y-auto rounded-[40px] pt-4 pb-2 shadow-2xl ${CARD_BG}`}>
        <div className="flex items-center gap-2 pl-5 pr-4">
          <h2 className="min-w-0 flex-1 text-xl font-bold break-words">{place ? place.name : 'New place'}</h2>
          {canEdit && (
            <Button small rounded inline className="px-4" disabled={busy || (circle && !center)} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          )}
          <CloseButton ref={closeButton} onClick={onClose} />
        </div>
        <p className="px-5 pt-1 text-sm opacity-60">
          {circle ? 'Move the map to put the circle on the place.' : 'Its shape was drawn in Traccar; change it there.'}
        </p>
        {status.kind === 'error' && (
          <p className="px-5 pt-1 text-sm text-red-500" role="alert">
            {status.message}
          </p>
        )}

        <List strong inset colors={ROWS} className="my-4!">
          <ListInput
            label="Name"
            value={name}
            maxLength={128}
            autoComplete="off"
            placeholder="Home"
            disabled={!canEdit}
            onInput={(event: React.FormEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
          />
        </List>

        {circle && (
          <>
            <BlockTitle>Size</BlockTitle>
            <List strong inset colors={ROWS}>
              <ListItem
                title={radiusLabel(Math.round(radius))}
                innerChildren={
                  <Range
                    className="mt-2"
                    min={0}
                    max={PLACE_RADII.length - 1}
                    step={1}
                    value={step}
                    disabled={!canEdit}
                    aria-label="Size"
                    aria-valuetext={radiusLabel(PLACE_RADII[step]!)}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => onRadiusChange(PLACE_RADII[Number(event.target.value)]!)}
                  />
                }
              />
            </List>
          </>
        )}

        <BlockTitle>For</BlockTitle>
        <List strong inset colors={ROWS}>
          {!managed ? (
            <ListItem title="Loading…" />
          ) : (
            managed.assets.map((asset) => (
              <ListItem
                key={asset.id}
                title={asset.name}
                after={
                  <Toggle
                    checked={assetIds?.includes(asset.id) ?? false}
                    disabled={!canEdit}
                    aria-label={`For ${asset.name}`}
                    onChange={() =>
                      setAssetIds((ids) => (ids?.includes(asset.id) ? ids.filter((id) => id !== asset.id) : [...(ids ?? []), asset.id]))
                    }
                  />
                }
              />
            ))
          )}
        </List>
        <BlockFooter>Traccar notes when these assets arrive and leave, and their details show it.</BlockFooter>

        {place && canEdit && (
          <List strong inset colors={ROWS}>
            <ListButton colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }} onClick={() => setConfirming(true)}>
              Remove place…
            </ListButton>
          </List>
        )}
        {managed && !canEdit && (
          <BlockFooter>Your Traccar account can't change places. An administrator can allow it in Traccar.</BlockFooter>
        )}
      </div>
      {place && (
        <Dialog
          opened={confirming}
          onBackdropClick={() => setConfirming(false)}
          title={`Remove ${place.name}?`}
          content="It's removed from Traccar. Past arrivals and departures stay in Traccar's reports."
          buttons={
            <>
              <DialogButton onClick={() => setConfirming(false)}>Cancel</DialogButton>
              <DialogButton
                strong
                className="text-red-500"
                onClick={() => {
                  setConfirming(false)
                  void run(() => deletePlace({ data: { id: place.id } }))
                }}
              >
                Remove
              </DialogButton>
            </>
          }
        />
      )}
    </section>
  )
}

function nearestStep(radius: number): number {
  let best = 0
  for (const [index, step] of PLACE_RADII.entries()) if (Math.abs(step - radius) < Math.abs(PLACE_RADII[best]! - radius)) best = index
  return best
}
