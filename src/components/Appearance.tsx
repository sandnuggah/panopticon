import { BlockFooter, BlockTitle, List, ListItem, Toggle } from 'konsta/react'
import { AUTO_STYLE, type MapStyle } from '../lib/mapStyles'
import { useSettings } from '../lib/settings'
import { TRAIL_OPTIONS, trailLabel } from '../lib/trail'

type Props = {
  listColors?: { strongBgIos: string }
  /** The map styles to choose between (see mapStyles.ts); one style means there's no choice. */
  styles: MapStyle[]
  defaultStyle: string
  /** Whether the server has map matching (MAP_MATCHING_URL), so Follow roads can be offered. */
  followRoads: boolean
}

/**
 * How the map looks: its style, how much recent movement it draws behind each asset, and how walks
 * are drawn (as paw prints, and snapped to paths: "Follow roads" in the code). Checkmark lists and
 * switches, like iOS Settings.
 */
export function AppearanceSettings({ listColors, styles, defaultStyle, followRoads }: Props) {
  const [settings, updateSettings] = useSettings()
  const styleChoice = settings.mapStyle ?? defaultStyle
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
          <BlockFooter>Auto is Standard in light mode and Dark in dark mode. Saved in this browser only.</BlockFooter>
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
        How much recent movement the map draws behind each asset. Today is everything since midnight. Saved in this
        browser only.
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
          className={followRoads ? undefined : 'opacity-50'}
          after={
            <Toggle
              checked={followRoads && settings.followRoads}
              disabled={!followRoads}
              onChange={() => updateSettings({ followRoads: !settings.followRoads })}
            />
          }
        />
      </List>
      <BlockFooter>
        Paw prints draws walks as a dog's tracks instead of a line.{' '}
        {followRoads
          ? 'Snap to paths draws them along the streets and paths they most likely took, instead of straight lines between GPS fixes.'
          : "Snap to paths draws them along the streets and paths they most likely took, but needs a map-matching server, which this one doesn't have (MAP_MATCHING_URL)."}{' '}
        Saved in this browser only.
      </BlockFooter>
    </>
  )
}

function CheckIcon() {
  return (
    <svg className="size-5 text-primary" viewBox="0 0 20 20" aria-label="Selected" role="img">
      <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
