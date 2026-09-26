import type { ReactNode } from 'react'
import { contactIsNewerThanFix, isStale, type Asset } from '../lib/asset'
import { useNow } from '../lib/useNow'
import { AssetAvatar } from './AssetAvatar'
import { RelativeTime } from './RelativeTime'

type Props = {
  assets: Asset[]
  selectedId: number | undefined
  onSelect: (id: number) => void
  /** Called for a tap on the panel itself, away from the cards and buttons. */
  onDeselect: () => void
  header?: ReactNode
  /** Controls at the end of the list: its bottom on wider screens, its right end on phones. */
  footer?: ReactNode
}

/** The list under the map on phones, beside it on wider screens. */
export function AssetSheet({ assets, selectedId, onSelect, onDeselect, header, footer }: Props) {
  return (
    // A convenience for pointer users, like tapping the map; the cards stay the keyboard way in.
    <section
      className="sheet"
      aria-label="Assets"
      onClick={(event) => {
        if (!(event.target as Element).closest('a, button')) onDeselect()
      }}
    >
      {header && <header className="sheet-header">{header}</header>}
      {assets.length === 0 ? (
        <p className="muted">No assets on this account yet.</p>
      ) : (
        <ul className="asset-cards">
          {assets.map((asset) => (
            <li key={asset.id}>
              <AssetCard asset={asset} selected={asset.id === selectedId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
      {footer && <footer className="sheet-footer">{footer}</footer>}
    </section>
  )
}

function AssetCard({ asset, selected, onSelect }: { asset: Asset; selected: boolean; onSelect: (id: number) => void }) {
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
      </span>
      <span className="asset-card-body">
        <span className="asset-card-title">
          <span className={`status-dot status-${asset.status}`} aria-hidden="true" />
          <span className="asset-card-name">{asset.name}</span>
          <span className="asset-card-status">{statusLabel(asset.status)}</span>
          {asset.battery?.percent !== undefined && <BatteryGauge percent={asset.battery.percent} />}
        </span>
        <span>
          {asset.location ? (
            <>
              Seen <RelativeTime time={asset.location.fixTime} />
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
      </span>
    </button>
  )
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

function statusLabel(status: Asset['status']): string {
  if (status === 'online') return 'Online'
  if (status === 'offline') return 'Offline'
  return 'No recent contact'
}
