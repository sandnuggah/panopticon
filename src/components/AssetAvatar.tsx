import { useState } from 'react'
import { assetInitial, type Asset } from '../lib/asset'

const SIZES = {
  small: 'size-10 text-base',
  large: 'size-24 text-4xl',
}

type Props = { asset: Pick<Asset, 'name' | 'imageUrl'>; size?: keyof typeof SIZES; stale?: boolean }

/** The asset's picture from Traccar, or its initial if there's none or it doesn't load. */
export function AssetAvatar({ asset, size = 'small', stale = false }: Props) {
  // Remember which URL failed, so a new picture gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = asset.imageUrl !== undefined && asset.imageUrl !== failedUrl
  return (
    <span
      className={`fixed-size relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ${SIZES[size]} ${stale ? 'bg-gray-400 dark:bg-gray-600' : 'bg-primary'}`}
      aria-hidden="true"
    >
      {assetInitial(asset.name)}
      {showImage && (
        <img
          className={`absolute inset-0 size-full object-cover ${stale ? 'opacity-70 grayscale' : ''}`}
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
