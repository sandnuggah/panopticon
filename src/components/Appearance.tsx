import { BlockFooter, BlockTitle, List, ListItem, Toggle } from 'konsta/react'
import { AUTO_STYLE, type MapStyle } from '../lib/mapStyles'
import { useSettings } from '../lib/settings'
import { TRAIL_OPTIONS, trailLabel } from '../lib/trail'
import { CheckIcon } from './icons'

type Props = {
  listColors?: { strongBgIos: string }
  /** The map styles to choose between (see mapStyles.ts); one style means there's no choice. */
  styles: MapStyle[]
  defaultStyle: string
  /** Whether the server has map matching (MAP_MATCHING_URL), so Snap to paths can be turned on. */
  canSnapToPaths: boolean
}

/**
 * How the map looks: its style, how much recent movement it draws behind each asset, and how walks
 * are drawn (as paw prints, and snapped to paths). Checkmark lists and
 * switches, like iOS Settings.
 */
export function Appearance({ listColors, styles, defaultStyle, canSnapToPaths }: Props) {
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
      <BlockTitle>Trail</BlockTitle>
      <List strong inset colors={listColors}>
        {TRAIL_OPTIONS.map((length) => (
          <ListItem
            key={length}
            link
            chevron={false}
            title={trailLabel(length)}
            after={length === settings.trail && <CheckIcon />}
            onClick={() => updateSettings({ trail: length })}
          />
        ))}
      </List>
      <BlockFooter>
        How much recent movement the map draws behind each asset. This outing is the walk under way, or the last one: since it left home,
        daycare or anywhere it stayed 20 minutes or more. Today is everything since midnight. Saved in this browser only.
      </BlockFooter>
      <BlockTitle>Walks</BlockTitle>
      <List strong inset colors={listColors}>
        <ListItem
          title="Paw prints"
          after={<Toggle checked={settings.pawPrints} onChange={() => updateSettings({ pawPrints: !settings.pawPrints })} />}
        />
        {/* Greyed out without a map-matching server (MAP_MATCHING_URL), which does the snapping. */}
        <ListItem
          title="Snap to paths"
          className={canSnapToPaths ? undefined : 'opacity-50'}
          after={
            <Toggle
              checked={canSnapToPaths && settings.snapToPaths}
              disabled={!canSnapToPaths}
              onChange={() => updateSettings({ snapToPaths: !settings.snapToPaths })}
            />
          }
        />
      </List>
      <BlockFooter>
        Paw prints draws walks as a dog's tracks instead of a line.{' '}
        {canSnapToPaths
          ? 'Snap to paths draws them along the streets and paths they most likely took, instead of straight lines between GPS fixes.'
          : "Snap to paths draws them along the streets and paths they most likely took, but needs a map-matching server, which this one doesn't have (MAP_MATCHING_URL)."}{' '}
        Saved in this browser only.
      </BlockFooter>
    </>
  )
}
