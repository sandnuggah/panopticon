import type { Asset, AssetBattery, AssetLocation } from './asset'
import { visitsBetween, type PlaceVisit } from './places'

// Messages the /live stream sends (as a JSON array per SSE message) and how the browser applies them.

export type LiveUpdate =
  | {
      kind: 'device'
      id: number
      name: string
      status: Asset['status']
      lastUpdate: string | null
      disabled: boolean
      imageUrl?: string
    }
  | {
      kind: 'position'
      id: number
      location: AssetLocation
      battery?: AssetBattery
      /** False when the tracker had no GPS fix; such points are never drawn on the trail. */
      valid: boolean
      /** The cell tower serving the tracker, when it reports one. */
      cell?: number
      /** The places this position is inside. */
      placeIds: number[]
    }

/**
 * Applies updates to the asset list. `unknown` is true when an update names an asset we don't have.
 * `visits` are the arrivals and departures the new positions mean.
 */
export function applyUpdates(assets: Asset[], updates: LiveUpdate[]): { assets: Asset[]; unknown: boolean; visits: PlaceVisit[] } {
  let next = assets
  let unknown = false
  const visits: PlaceVisit[] = []
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
        : {
            ...current,
            name: update.name,
            status: update.status,
            lastUpdate: update.lastUpdate,
            imageUrl: update.imageUrl,
          }
    } else {
      // Trackers can deliver buffered positions late; never move backwards in time.
      if (current.location && Date.parse(update.location.fixTime) < Date.parse(current.location.fixTime)) continue
      // A position without battery keeps the last known value.
      replacement = { ...current, location: update.location, battery: update.battery ?? current.battery, placeIds: update.placeIds }
      visits.push(...visitsBetween(current.id, current.placeIds, update.placeIds, update.location.fixTime))
    }
    next = replacement ? next.map((asset, i) => (i === index ? replacement : asset)) : next.filter((_, i) => i !== index)
  }
  if (next !== assets) next = [...next].sort((a, b) => a.name.localeCompare(b.name))
  return { assets: next, unknown, visits }
}
