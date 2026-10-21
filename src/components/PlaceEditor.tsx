import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { BlockFooter, BlockTitle, Button, Dialog, DialogButton, List, ListButton, ListInput, ListItem, Range, Toggle } from 'konsta/react'
import { editErrorMessage } from '../lib/editErrors'
import { PLACE_RADII, placeCenter, radiusLabel, type Place } from '../lib/places'
import type { LatLon } from '../lib/segments'
import { getManagedAssets } from '../server/manage.functions'
import { getAddress } from '../server/map.functions'
import { deletePlace, findAddresses, savePlaceChange } from '../server/places.functions'
import type { FoundAddress } from '../server/geocode.server'
import type { EditResult } from '../server/manage.server'
import type { Inset } from './map/PlacePicker'
import { CARD_BG, CloseButton, moveFocus, ROWS, SIDE_PANEL_ABOVE_ZOOM, sidePanel } from './cards'

type Managed = Awaited<ReturnType<typeof getManagedAssets>>

type Props = {
  /** The place to change, or null for a new one. */
  place: Place | null
  /** The circle's radius, shared with the map's picker. */
  radius: number
  onRadiusChange: (radius: number) => void
  /** The middle of the visible map, where the circle is (see PlacePicker). */
  center: LatLon | null
  /** How much of the map the card covers, so the map can keep the circle in the rest (see PlacePicker). */
  onInset: (inset: Inset) => void
  /** Whether the server can find addresses (GEOCODER_URL). */
  canSearch: boolean
  /** Moves the map, and so the circle, to a point: an address found. */
  onGoTo: (point: LatLon) => void
  /** Back to the list of places, after saving, removing or cancelling. */
  onClose: () => void
}

/** Waits this long after the map stops before looking up the address at the circle. */
const ADDRESS_DEBOUNCE_MS = 600

/**
 * Adding or changing a place, in a card at the bottom of the map screen while the map above it
 * places the circle (PlacePicker): its name, address, size, and which assets it's for. The address
 * is filled in from where the circle is, until it's edited, and can be searched for. Polygons drawn
 * in Traccar can be renamed, given an address and given to assets, but their shape is changed in Traccar.
 */
export function PlaceEditor({ place, radius, onRadiusChange, center, onInset, canSearch, onGoTo, onClose }: Props) {
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
  const [address, setAddress] = useState(place?.address ?? '')
  // Once typed or chosen, the address stays put; until then it follows the circle.
  const [addressChosen, setAddressChosen] = useState(place?.address !== undefined)
  // The address chosen from a search, and where it was found, for its way in.
  const [found, setFound] = useState<FoundAddress | null>(null)
  const [results, setResults] = useState<FoundAddress[] | null>(null)
  const [searching, setSearching] = useState(false)
  const lookAt = circle ? center : place ? placeCenter(place.area) : null

  useEffect(() => {
    if (addressChosen || !lookAt) return
    let cancelled = false
    const timer = setTimeout(() => {
      getAddress({ data: lookAt })
        .then((found) => {
          if (!cancelled && found) setAddress(found)
        })
        .catch(() => {})
    }, ADDRESS_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [addressChosen, lookAt?.lat, lookAt?.lon])

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

  // What the card covers, for the map: the bottom on a phone (its height changes with an error
  // message or the text size), the right side on a wide screen, where it's a side panel.
  useLayoutEffect(() => {
    const element = card.current
    if (!element) return
    const report = () => {
      const rect = element.getBoundingClientRect()
      const side = window.matchMedia('(min-width: 1024px)').matches
      onInset(side ? { bottom: 0, right: window.innerWidth - rect.left + 12 } : { bottom: rect.height + 8, right: 0 })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [onInset])

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
          address: address.trim() || null,
          found: found && found.label === address.trim() ? found.point : null,
        },
      }),
    )
  }

  async function search() {
    const query = address.trim()
    if (!query || searching) return
    setSearching(true)
    setResults(null)
    try {
      const found = await findAddresses({ data: { query, near: lookAt } })
      if (found.length === 0) setStatus({ kind: 'error', message: `Couldn't find ${query}.` })
      else if (found.length === 1) choose(found[0]!)
      else setResults(found)
    } catch {
      setStatus({ kind: 'error', message: "Couldn't search for the address. Try again." })
    } finally {
      setSearching(false)
    }
  }

  function choose(result: FoundAddress) {
    setAddress(result.label)
    setAddressChosen(true)
    setFound(result)
    setResults(null)
    setStatus({ kind: 'idle' })
    if (circle) onGoTo(result.point)
  }

  const canEdit = managed?.access.canEdit === true
  const busy = status.kind === 'busy'
  // The slider moves through PLACE_RADII; a radius set elsewhere sits at the nearest step until moved.
  const step = nearestStep(radius)

  return (
    <section
      role="dialog"
      aria-label={place ? `Edit ${place.name}` : 'New place'}
      className={`absolute inset-x-0 bottom-0 z-30 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))] ${sidePanel('right')}`}
    >
      <div
        ref={card}
        className={`relative max-h-[50dvh] overflow-y-auto rounded-[40px] pt-4 pb-2 shadow-2xl ${SIDE_PANEL_ABOVE_ZOOM} ${CARD_BG}`}
      >
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
          <ListInput
            label="Address"
            value={address}
            maxLength={200}
            autoComplete="off"
            placeholder="Street and number, town"
            disabled={!canEdit}
            onInput={(event: React.FormEvent<HTMLInputElement>) => {
              setAddress(event.currentTarget.value)
              setAddressChosen(true)
              setResults(null)
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter' && canSearch) void search()
            }}
          />
          {canSearch && canEdit && (
            <ListButton className={searching || !address.trim() ? 'opacity-50' : ''} onClick={() => void search()}>
              {searching ? 'Finding…' : circle ? 'Find on the map' : 'Find'}
            </ListButton>
          )}
          {results?.map((result) => (
            <ListItem key={`${result.point.lat},${result.point.lon}`} link title={result.label} onClick={() => choose(result)} />
          ))}
        </List>
        <BlockFooter>Walks to and from the place start on the street in its address.</BlockFooter>

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
