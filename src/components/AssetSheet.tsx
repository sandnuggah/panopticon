import { useState, type ReactNode } from 'react'
import { assetInitial, contactIsNewerThanFix, isStale, type Asset } from '../lib/asset'
import { useNow } from '../lib/useNow'
import { RelativeTime } from './RelativeTime'

type Props = {
  assets: Asset[]
  selectedId: number | undefined
  onSelect: (id: number) => void
  header?: ReactNode
  /** Controls at the end of the list: its bottom on wider screens, its right end on phones. */
  footer?: ReactNode
}

/** The list under the map on phones, beside it on wider screens. */
export function AssetSheet({ assets, selectedId, onSelect, header, footer }: Props) {
  return (
    <section className="sheet" aria-label="Assets">
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
        {/* Only shown in the compact phone list, where the name and details are hidden. */}
        <span className={`avatar-status status-${asset.status}`} aria-hidden="true" />
      </span>
      <span className="asset-card-body">
        <span className="asset-card-title">
          <span className={`status-dot status-${asset.status}`} aria-hidden="true" />
          <span className="asset-card-name">{asset.name}</span>
          <span className="asset-card-status">{statusLabel(asset.status)}</span>
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
        <Battery battery={asset.battery} />
      </span>
    </button>
  )
}

/** The asset's picture from Traccar, or its initial if there's none or it doesn't load. */
function AssetAvatar({ asset }: { asset: Asset }) {
  // Remember which URL failed, so a new picture gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = asset.imageUrl !== undefined && asset.imageUrl !== failedUrl
  return (
    <span className="avatar" aria-hidden="true">
      <span className="avatar-initial">{assetInitial(asset.name)}</span>
      {showImage && (
        <img
          className="avatar-image"
          src={asset.imageUrl}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(asset.imageUrl ?? null)}
        />
      )}
    </span>
  )
}

function Battery({ battery }: { battery: Asset['battery'] }) {
  if (battery?.percent !== undefined) {
    const low = battery.percent <= 20
    return <span className={low ? 'battery-low' : 'muted'}>Battery {Math.round(battery.percent)}%</span>
  }
  if (battery?.volts !== undefined) {
    return <span className="muted">Battery {battery.volts} V</span>
  }
  return null
}

function statusLabel(status: Asset['status']): string {
  if (status === 'online') return 'Online'
  if (status === 'offline') return 'Offline'
  return 'No recent contact'
}
