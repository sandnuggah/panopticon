import type { ReactNode } from 'react'
import { contactIsNewerThanFix, isStale, type Asset } from '../lib/asset'
import type { Activity, Stay } from '../lib/segments'
import { useNow } from '../lib/useNow'
import { AssetAvatar } from './AssetAvatar'
import { RelativeTime } from './RelativeTime'
import { ShareLocationButton } from './ShareLocationButton'

type Props = {
  assets: Asset[]
  /** What each asset is doing right now, when it's riding (see segments.ts). */
  activities: Record<number, Activity>
  /** How long each asset has been in one place, when it's staying put. */
  stays: Record<number, Stay>
  selectedId: number | undefined
  /** The selected asset's street address, when known. */
  selectedAddress?: string
  onSelect: (id: number) => void
  /** Called for a tap on the panel itself, away from the cards and buttons. */
  onDeselect: () => void
  header?: ReactNode
  /** Controls at the end of the list: its bottom on wider screens, its right end on phones. */
  footer?: ReactNode
}

/** The list under the map on phones, beside it on wider screens. */
export function AssetSheet(props: Props) {
  const { assets, activities, stays, selectedId, selectedAddress, onSelect, onDeselect, header, footer } = props
  const selected = assets.find((asset) => asset.id === selectedId)
  return (
    // A convenience for pointer users, like tapping the map; the cards stay the keyboard way in.
    <section
      className="sheet"
      aria-label="Assets"
      onClick={(event) => {
        if (!(event.target as Element).closest('a, button, .asset-details, .asset-card-actions')) onDeselect()
      }}
    >
      {header && <header className="sheet-header">{header}</header>}
      {selected && (
        <AssetDetails
          asset={selected}
          activity={activities[selected.id]}
          stay={stays[selected.id]}
          address={selectedAddress}
          onClose={onDeselect}
        />
      )}
      {assets.length === 0 ? (
        <p className="muted">No assets on this account yet.</p>
      ) : (
        <ul className="asset-cards">
          {assets.map((asset) => (
            <li key={asset.id}>
              <AssetCard
                asset={asset}
                activity={activities[asset.id]}
                stay={stays[asset.id]}
                selected={asset.id === selectedId}
                address={asset.id === selectedId ? selectedAddress : undefined}
                onSelect={onSelect}
              />
              {/* Desktop only: on phones the details above the row have these. */}
              {asset.id === selectedId && (
                <div className="asset-card-actions">
                  <ShareLocationButton asset={asset} address={selectedAddress} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {footer && <footer className="sheet-footer">{footer}</footer>}
    </section>
  )
}

type CardProps = {
  asset: Asset
  activity: Activity | undefined
  stay: Stay | undefined
  selected: boolean
  address: string | undefined
  onSelect: (id: number) => void
}

function AssetCard({ asset, activity, stay, selected, address, onSelect }: CardProps) {
  const now = useNow(30_000)
  const stale = isStale(asset, now)
  return (
    <button
      type="button"
      className={`asset-card${selected ? ' asset-card-selected' : ''}${stale ? ' asset-card-stale' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(asset.id)}
    >
      <span className="avatar-wrap">
        <AssetAvatar asset={asset} />
        {/* Only shown in the compact phone list, where the name and details are hidden (screen readers
            still get those, so these two are decorative). */}
        <span className={`avatar-status status-${asset.status}`} aria-hidden="true" />
        {asset.battery?.percent !== undefined && (
          <span className="avatar-battery" aria-hidden="true">
            <BatteryGauge percent={asset.battery.percent} />
          </span>
        )}
        {activity && (
          <span className="avatar-activity" aria-hidden="true">
            <TransitIcon />
          </span>
        )}
      </span>
      <span className="asset-card-body">
        <span className="asset-card-title">
          <span className={`status-dot status-${asset.status}`} aria-hidden="true" />
          <span className="asset-card-name">{asset.name}</span>
          <span className="asset-card-status">{statusLabel(asset.status)}</span>
          {asset.battery?.percent !== undefined && <BatteryGauge percent={asset.battery.percent} />}
        </span>
        <AssetFacts asset={asset} activity={activity} stay={stay} address={address} />
      </span>
    </button>
  )
}

/**
 * The selected asset on phones, above the row of avatars: what the desktop card shows, with room
 * for actions. On wider screens the selected card itself shows all this, so it's hidden there.
 */
function AssetDetails({ asset, activity, stay, address, onClose }: DetailsProps) {
  const percent = asset.battery?.percent
  return (
    <section className="asset-details" aria-label={asset.name}>
      <div className="asset-details-title">
        <span className="asset-details-name">{asset.name}</span>
        <span className="asset-details-status">
          <span className={`status-dot status-${asset.status}`} aria-hidden="true" />
          {statusLabel(asset.status)}
        </span>
        {percent !== undefined && (
          <span className="asset-details-battery">
            <BatteryGauge percent={percent} />
            <span aria-hidden="true">{Math.round(percent)}%</span>
          </span>
        )}
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="asset-details-facts">
        <AssetFacts asset={asset} activity={activity} stay={stay} address={address} />
      </div>
      <ShareLocationButton asset={asset} address={address} />
    </section>
  )
}

type DetailsProps = {
  asset: Asset
  activity: Activity | undefined
  stay: Stay | undefined
  address: string | undefined
  onClose: () => void
}

/** Where the asset is and what it's doing, line by line; the card and the details share these. */
function AssetFacts({ asset, activity, stay, address }: FactsProps) {
  return (
    <>
      {activity && (
        <span className="asset-card-activity">
          <TransitIcon />
          {activityLabel(activity)}
        </span>
      )}
      {address && <span className="asset-card-address">{address}</span>}
      <span>
        {asset.location ? (
          <>
            Seen <RelativeTime time={asset.location.fixTime} />
            {stay && !activity && <> · {stayLabel(stay)}</>}
          </>
        ) : (
          'No location yet'
        )}
      </span>
      {asset.lastUpdate && (!asset.location || contactIsNewerThanFix(asset)) && (
        <span className="muted">
          Last contact <RelativeTime time={asset.lastUpdate} />
        </span>
      )}
      {/* Trackers that report volts only: shown as text, since volts don't map to bars reliably. */}
      {asset.battery?.percent === undefined && asset.battery?.volts !== undefined && (
        <span className="muted">Battery {asset.battery.volts} V</span>
      )}
    </>
  )
}

type FactsProps = { asset: Asset; activity: Activity | undefined; stay: Stay | undefined; address: string | undefined }

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** "Here since 07:12", or "since before" when the stay goes back further than the history loaded. */
function stayLabel(stay: Stay): string {
  return `Here since ${stay.began ? '' : 'before '}${clock.format(stay.since)}`
}

/**
 * The battery as a gauge with 0–4 bars, drawn in the warning colour at 20% or below. The exact
 * percentage is its label, for screen readers and as the hover tooltip.
 */
function BatteryGauge({ percent }: { percent: number }) {
  const bars = batteryBars(percent)
  const label = `Battery ${Math.round(percent)}%`
  return (
    // Drawn on a pixel grid at the size it's shown (16.5 × 9 CSS px), so the 1px outline and the
    // bars land on whole pixels instead of blurring between them.
    <svg
      className={`battery-gauge${percent <= 20 ? ' battery-gauge-low' : ''}`}
      viewBox="0 0 16.5 9"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <rect x="0.5" y="0.5" width="14" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="15" y="3" width="1.5" height="3" rx="0.5" fill="currentColor" />
      {Array.from({ length: bars }, (_, bar) => (
        <rect key={bar} x={2 + bar * 3} y="2" width="2" height="5" fill="currentColor" />
      ))}
    </svg>
  )
}

/** Empty below 5%, then one bar per started quarter: 5–25% is one bar, 76–100% is four. */
function batteryBars(percent: number): number {
  if (percent < 5) return 0
  return Math.min(4, Math.ceil(percent / 25))
}

function activityLabel(activity: Activity): string {
  return activity === 'underground' ? 'Moving underground' : 'In a vehicle'
}

/** The front of a train or bus: any vehicle. Decorative; the label says which. */
function TransitIcon() {
  return (
    <svg className="transit-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="4" width="6" height="3" rx="0.75" fill="currentColor" />
      <circle cx="5.75" cy="9.75" r="1" fill="currentColor" />
      <circle cx="10.25" cy="9.75" r="1" fill="currentColor" />
      <path d="M5.5 12.5 4 15M10.5 12.5 12 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function statusLabel(status: Asset['status']): string {
  if (status === 'online') return 'Online'
  if (status === 'offline') return 'Offline'
  return 'No recent contact'
}
