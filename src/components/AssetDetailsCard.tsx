import { useEffect, useRef } from 'react'
import { contactIsNewerThanFix, isStale, statusLabel, type Asset } from '../lib/asset'
import type { Activity, Stay } from '../lib/segments'
import { useNow } from '../lib/useNow'
import { AssetAvatar } from './AssetAvatar'
import { BatteryGauge } from './BatteryGauge'
import { RelativeTime } from './RelativeTime'
import { Share } from './Share'

type Props = {
  /** The asset to show, or undefined while the card is closed. */
  asset: Asset | undefined
  /** What it's doing right now, when it's riding (see segments.ts). */
  activity: Activity | undefined
  /** How long it's been in one place, when it's staying put. */
  stay: Stay | undefined
  /** Its street address, when known. */
  address: string | undefined
  /** False while a card over this one is open (Settings), so Escape closes that one instead. */
  onTop: boolean
  onClose: () => void
}

/**
 * The selected asset's details, in a card from the bottom like Apple Maps' place card, opened by
 * tapping its picture in the bottom bar a second time. No backdrop: the map stays in view and can
 * be moved. Absolute inside the map screen, like the Settings card (see BottomBar.tsx).
 */
export function AssetDetailsCard({ asset, activity, stay, address, onTop, onClose }: Props) {
  const open = asset !== undefined
  const closeButton = useRef<HTMLButtonElement>(null)
  // While the card slides away it keeps showing what it showed.
  const last = useRef<{ asset: Asset; activity?: Activity; stay?: Stay; address?: string }>(undefined)
  if (asset) last.current = { asset, activity, stay, address }
  const shown = last.current

  useEffect(() => {
    // preventScroll: see BottomBar.tsx.
    if (open) closeButton.current?.focus({ preventScroll: true })
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
      role="dialog"
      aria-label={shown?.asset.name ?? 'Asset'}
      inert={!open}
      className={`absolute inset-x-0 bottom-0 z-20 mx-auto max-w-xl px-2 pb-[max(8px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out ${open ? '' : 'translate-y-[calc(100%+16px)]'}`}
    >
      <div className="relative max-h-[60dvh] overflow-y-auto rounded-[2.5rem] px-5 pb-5 pt-5 shadow-2xl ios:bg-ios-light-surface ios:dark:bg-[#1c1c1e] material:bg-md-light-surface-1 material:dark:bg-md-dark-surface-1">
        <button
          ref={closeButton}
          type="button"
          className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-black/5 active:opacity-60 dark:bg-white/10"
          aria-label="Close"
          onClick={onClose}
        >
          <svg className="size-5" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        {shown && <Details {...shown} open={open} />}
      </div>
    </section>
  )
}

function Details({
  asset,
  activity,
  stay,
  address,
  open,
}: {
  asset: Asset
  activity?: Activity
  stay?: Stay
  address?: string
  open: boolean
}) {
  const now = useNow(30_000)
  const percent = asset.battery?.percent
  return (
    <>
      <div className="flex items-center gap-3 pr-12">
        <AssetAvatar asset={asset} stale={isStale(asset, now)} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-2xl font-bold">{asset.name}</h2>
          <div className="flex items-center gap-1.5 text-sm opacity-60">
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
        {address && <p className="text-[17px] font-semibold">{address}</p>}
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
      <Share asset={asset} address={address} active={open} />
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
