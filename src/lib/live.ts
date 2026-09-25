import type { Asset, AssetBattery, AssetLocation } from './asset'

// Messages the /live stream sends (as a JSON array per SSE message) and how the browser applies them.

export type LiveUpdate =
  | {
      kind: 'device'
      id: number
      name: string
      status: Asset['status']
      lastUpdate: string | null
      disabled: boolean
    }
  | {
      kind: 'position'
      id: number
      location: AssetLocation
      battery?: AssetBattery
      /** False when the tracker had no GPS fix; such points are kept off the trail. */
      valid: boolean
    }

/** Applies updates to the asset list. `unknown` is true when an update names an asset we don't have. */
export function applyUpdates(assets: Asset[], updates: LiveUpdate[]): { assets: Asset[]; unknown: boolean } {
  let next = assets
  let unknown = false
  for (const update of updates) {
    const index = next.findIndex((asset) => asset.id === update.id)
    if (index === -1) {
      if (!(update.kind === 'device' && update.disabled)) unknown = true
      continue
    }
    const current = next[index]!
    let replacement: Asset | null
    if (update.kind === 'device') {
      replacement = update.disabled
        ? null
        : { ...current, name: update.name, status: update.status, lastUpdate: update.lastUpdate }
    } else {
      // Trackers can deliver buffered positions late; never move backwards in time.
      if (current.location && Date.parse(update.location.fixTime) < Date.parse(current.location.fixTime)) continue
      // A position without battery keeps the last known value.
      replacement = { ...current, location: update.location, battery: update.battery ?? current.battery }
    }
    next = replacement
      ? next.map((asset, i) => (i === index ? replacement : asset))
      : next.filter((_, i) => i !== index)
  }
  if (next !== assets) next = [...next].sort((a, b) => a.name.localeCompare(b.name))
  return { assets: next, unknown }
}
