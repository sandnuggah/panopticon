import { useEffect, useState } from 'react'
import { BlockFooter, List, ListButton, ListItem } from 'konsta/react'
import { getManagedAssets } from '../server/manage.functions'
import { AssetAvatar } from './AssetAvatar'

type Managed = Awaited<ReturnType<typeof getManagedAssets>>

type Props = {
  listColors?: { strongBgIos: string }
  onOpen: (id: number) => void
  onAdd: () => void
}

/** Every device the user can see, including ones disabled in Traccar, with Add asset at the end. */
export function AssetsList({ listColors, onOpen, onAdd }: Props) {
  const [data, setData] = useState<Managed>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getManagedAssets()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data) {
    return (
      <List strong inset colors={listColors}>
        <ListItem title={failed ? "Couldn't load the assets. Try again." : 'Loading…'} />
      </List>
    )
  }

  const { access, assets } = data
  return (
    <>
      <List strong inset colors={listColors}>
        {assets.length === 0 ? (
          <ListItem title="No assets on this account yet" />
        ) : (
          assets.map((asset) => (
            <ListItem
              key={asset.id}
              link={access.canEdit}
              media={<AssetAvatar asset={asset} />}
              title={asset.name}
              subtitle={asset.disabled ? 'Disabled in Traccar' : undefined}
              onClick={access.canEdit ? () => onOpen(asset.id) : undefined}
            />
          ))
        )}
      </List>
      {access.canAdd && (
        <List strong inset colors={listColors}>
          <ListButton onClick={onAdd}>Add asset</ListButton>
        </List>
      )}
      {!access.canEdit && (
        <BlockFooter>Your Traccar account can't change assets. An administrator can allow it in Traccar.</BlockFooter>
      )}
    </>
  )
}
