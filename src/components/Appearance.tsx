import { BlockFooter, BlockTitle, List, ListItem } from 'konsta/react'
import { AUTO_STYLE, type MapStyle } from '../lib/mapStyles'
import { useSettings } from '../lib/settings'
import { CheckIcon } from './icons'

type Props = {
  listColors?: { strongBgIos: string }
  /** The map styles to choose between (see mapStyles.ts); one style means there's no choice. */
  styles: MapStyle[]
  defaultStyle: string
}

/**
 * How the map looks: its style, as a checkmark list like iOS Settings. How each asset's trail is
 * drawn is on its page (AssetEditor).
 */
export function Appearance({ listColors, styles, defaultStyle }: Props) {
  const [settings, updateSettings] = useSettings()
  const styleChoice = settings.mapStyle ?? defaultStyle
  const defaultName = styles.find((style) => style.id === defaultStyle)?.name ?? 'the default'
  return (
    <>
      {styles.length > 1 && (
        <>
          <BlockTitle>Map style</BlockTitle>
          <List strong inset colors={listColors}>
            {[{ id: AUTO_STYLE, name: 'Auto (light or dark)' }, ...styles].map((style) => (
              <ListItem
                key={style.id}
                link
                chevron={false}
                title={style.name}
                after={style.id === styleChoice && <CheckIcon />}
                onClick={() => updateSettings({ mapStyle: style.id })}
              />
            ))}
          </List>
          <BlockFooter>Auto is {defaultName} in light mode and Dark in dark mode. Saved in this browser only.</BlockFooter>
        </>
      )}
      <BlockFooter>
        How each asset's trail is drawn (how much of it, paw prints, Snap to paths) is on its own page, under Assets.
      </BlockFooter>
    </>
  )
}
