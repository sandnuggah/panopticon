import { useEffect, useRef } from 'react'
import { contactIsNewerThanFix, isStale, statusLabel, type Asset } from '../lib/asset'
import type { Place } from '../lib/places'
import type { Activity, Stay } from '../lib/segments'
import { useNow } from '../lib/useNow'
import { AssetAvatar } from './AssetAvatar'
import { BatteryGauge } from './BatteryGauge'
import { CARD_BG, CloseButton, moveFocus, SIDE_PANEL_MAX_HEIGHT, sidePanel, sidePanelClosed, useCover, type Cover } from './cards'
import { PlaceVisits } from './PlaceVisits'
import { RelativeTime } from './RelativeTime'
import { Share } from './Share'
import { Stats } from './Stats'

type Props = {
  /** The asset to show, or undefined while the card is closed. */
  asset: Asset | undefined
  /** What it's doing right now, when it's riding (see segments.ts). */
  activity: Activity | undefined
  /** How long it's been in one place, when it's staying put. */
  stay: Stay | undefined
  /** Its street address, when known. */
  address: string | undefined
  /** The user's places: shown instead of the address while it's at one, with its arrivals and departures. */
  places: Place[]
  /** False while a card over this one is open (Settings), so Escape closes that one instead. */
  onTop: boolean
  onClose: () => void
  /** What the card covers of the map while open, so the map centres the asset in what's left. */
  onCover: (cover: Cover) => void
}

/**
 * The selected asset's details, in a card from the bottom like Apple Maps' place card, opened by
 * tapping its picture in the bottom bar a second time. No backdrop: the map stays in view and can
 * be moved. Absolute inside the map screen, like the Settings card (see BottomBar.tsx).
 */
export function AssetDetailsCard({ asset, activity, stay, address, places, onTop, onClose, onCover }: Props) {
  const open = asset !== undefined
  const card = useRef<HTMLElement>(null)
  useCover(card, open, onCover)
  const closeButton = useRef<HTMLButtonElement>(null)
  // While the card slides away it keeps showing what it showed.
  const last = useRef<{ asset: Asset; activity?: Activity; stay?: Stay; address?: string }>(undefined)
  if (asset) last.current = { asset, activity, stay, address }
  const shown = last.current

  // Focus moves to ✕ as the card opens, and back to what had it (the asset's picture in the bottom
  // bar) as it closes, so it never stays on a button in the hidden card.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      moveFocus(closeButton.current)
    } else if (opener.current) {
      if (opener.current.isConnected) moveFocus(opener.current)
      opener.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !onTop) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onTop, onClose])

  return (
    <section
      ref={card}
      role="dialog"
      aria-label={shown?.asset.name ?? 'Asset'}
      inert={!open}
      className={`absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out ${sidePanel('left')} ${open ? '' : `translate-y-[calc(100%+16px)] ${sidePanelClosed('left')}`}`}
    >
      <div
        className={`relative max-h-[60dvh] overflow-y-auto rounded-[40px] px-5 pb-5 pt-5 shadow-2xl ${SIDE_PANEL_MAX_HEIGHT} ${CARD_BG}`}
      >
        <CloseButton ref={closeButton} className="absolute right-4 top-4" onClick={onClose} />
        {shown && <Details {...shown} places={places} open={open} />}
      </div>
    </section>
  )
}

function Details({
  asset,
  activity,
  stay,
  address,
  places,
  open,
}: {
  asset: Asset
  activity?: Activity
  stay?: Stay
  address?: string
  places: Place[]
  open: boolean
}) {
  const now = useNow(30_000)
  const percent = asset.battery?.percent
  // Where it is, as Find My says it: "Home" rather than the street address.
  const at = places.find((place) => asset.placeIds.includes(place.id))
  const hasPlaces = places.some((place) => place.assetIds.includes(asset.id))
  return (
    <>
      <div className="flex items-center gap-3 pr-12">
        <AssetAvatar asset={asset} stale={isStale(asset, now)} />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold break-words">{asset.name}</h2>
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm opacity-60">
            <StatusDot status={asset.status} />
            {statusLabel(asset.status)}
            {percent !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <BatteryGauge percent={percent} />
                <span aria-hidden="true">{Math.round(percent)}%</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-0.5 py-4">
        {activity && <p className="font-semibold text-primary">{activityLabel(activity)}</p>}
        {at ? (
          <p className="text-[1.0625rem] font-semibold">{at.name}</p>
        ) : (
          address && <p className="text-[1.0625rem] font-semibold">{address}</p>
        )}
        <p className="opacity-60">
          <Summary asset={asset} stay={activity ? undefined : stay} />
        </p>
        {asset.lastUpdate && (!asset.location || contactIsNewerThanFix(asset)) && (
          <p className="opacity-60">
            Last contact <RelativeTime time={asset.lastUpdate} />
          </p>
        )}
        {/* Trackers that report volts only: shown as text, since volts don't map to bars reliably. */}
        {percent === undefined && asset.battery?.volts !== undefined && <p className="opacity-60">Battery {asset.battery.volts} V</p>}
      </div>
      <Share asset={asset} address={address} active={open} beside={<Stats asset={asset} places={places} active={open} />} />
      {hasPlaces && <PlaceVisits assetId={asset.id} places={places} placeIds={asset.placeIds} />}
    </>
  )
}

/** When it was seen and how long it's been there. */
function Summary({ asset, stay }: { asset: Asset; stay: Stay | undefined }) {
  if (!asset.location) return <>No location yet</>
  return (
    <>
      Seen <RelativeTime time={asset.location.fixTime} />
      {stay && <> · {stayLabel(stay)}</>}
    </>
  )
}

function StatusDot({ status }: { status: Asset['status'] }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${status === 'online' ? 'bg-[var(--online)]' : 'bg-[var(--offline)]'}`}
      aria-hidden="true"
    />
  )
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Here since 07:12", or "since before" when the stay goes back further than the history loaded. */
function stayLabel(stay: Stay): string {
  return `Here since ${stay.began ? '' : 'before '}${clock.format(stay.since)}`
}

function activityLabel(activity: Activity): string {
  return activity === 'underground' ? 'Moving underground' : 'In a vehicle'
}
