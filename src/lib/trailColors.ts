// The trail's colours to choose from (Appearance → Trail colour), each in a shade for a day map and
// one for a night map: the map style can be light or dark whatever the device's mode. None of them
// is the places' purple (--place), so a pin never reads as part of the trail.

export type TrailColor = { id: string; name: string; day: string; night: string }

export const TRAIL_COLORS: TrailColor[] = [
  { id: 'green', name: 'Green', day: '#2f8f5b', night: '#5cc98d' },
  { id: 'blue', name: 'Blue', day: '#1a6fd6', night: '#5ea8ff' },
  { id: 'orange', name: 'Orange', day: '#d4600a', night: '#ff9f43' },
  { id: 'pink', name: 'Pink', day: '#d1336b', night: '#ff6b9a' },
  { id: 'graphite', name: 'Graphite', day: '#45454a', night: '#d1d1d6' },
]

export const DEFAULT_TRAIL_COLOR = 'green'

/** The trail's colour on a day or night map, by its id; the default's for an id no longer offered. */
export function trailColorOf(id: string | undefined, dark: boolean): string {
  const color = TRAIL_COLORS.find((option) => option.id === id) ?? TRAIL_COLORS.find((option) => option.id === DEFAULT_TRAIL_COLOR)!
  return dark ? color.night : color.day
}
