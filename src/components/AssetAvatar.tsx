import { useState } from 'react'
import { assetInitial, type Asset } from '../lib/asset'

/** The asset's picture from Traccar, or its initial if there's none or it doesn't load. */
export function AssetAvatar({ asset }: { asset: Pick<Asset, 'name' | 'imageUrl'> }) {
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
