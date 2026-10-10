import { useEffect, useState } from 'react'
import { BlockFooter, List, ListButton, ListItem } from 'konsta/react'
import type { Asset } from '../lib/asset'
import { radiusLabel, type Place } from '../lib/places'
import { getManagedAssets } from '../server/manage.functions'

type Props = {
  places: Place[]
  /** The assets on the map, to say which ones each place is for. */
  assets: Asset[]
  listColors?: { strongBgIos: string }
  /** Opens a place in the editor on the map, or a new one. */
  onOpen: (id: number | 'new') => void
}

/** The user's places (Traccar geofences), each for some of the assets, with Add place at the end. */
export function PlacesList({ places, assets, listColors, onOpen }: Props) {
  // Whether the user may change places: the same Traccar rights as changing assets.
  const [canEdit, setCanEdit] = useState<boolean>()

  useEffect(() => {
    let cancelled = false
    getManagedAssets()
      .then((result) => {
        if (!cancelled) setCanEdit(result.access.canEdit)
      })
      .catch(() => {
        if (!cancelled) setCanEdit(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const names = (place: Place) => {
    const linked = assets.filter((asset) => place.assetIds.includes(asset.id)).map((asset) => asset.name)
    return linked.length ? linked.join(', ') : 'No assets'
  }

  return (
    <>
      <List strong inset colors={listColors}>
        {places.length === 0 ? (
          <ListItem title="No places yet" />
        ) : (
          places.map((place) => (
            <ListItem
              key={place.id}
              link={canEdit === true}
              title={place.name}
              subtitle={names(place)}
              after={place.area.kind === 'circle' ? radiusLabel(place.area.radius) : undefined}
              onClick={canEdit ? () => onOpen(place.id) : undefined}
            />
          ))
        )}
      </List>
      {canEdit && (
        <List strong inset colors={listColors}>
          <ListButton onClick={() => onOpen('new')}>Add place</ListButton>
        </List>
      )}
      <BlockFooter>
        Places like Home or Daycare. An asset's details show when it's at one, and when it arrived and left. Kept in Traccar as geofences.
        {canEdit === false && " Your Traccar account can't change them; an administrator can allow it in Traccar."}
      </BlockFooter>
    </>
  )
}
