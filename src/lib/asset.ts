export type AssetLocation = {
  lat: number
  lon: number
  /** Metres, when the tracker reports it. */
  accuracy?: number
  /** When the asset was at this location (ISO time). */
  fixTime: string
}

export type AssetBattery = {
  percent?: number
  volts?: number
}

/**
 * Anything being tracked (a pet, a bike, a bag…). Built on the server from a Traccar device
 * and its latest position; this is all the browser ever gets.
 */
export type Asset = {
  id: number
  name: string
  status: 'online' | 'offline' | 'unknown'
  /** Last contact from the tracker (ISO time), null if it has never connected. */
  lastUpdate: string | null
  /** Latest known location, null until the tracker's first position. */
  location: AssetLocation | null
  /** Only present when the tracker reports battery. */
  battery?: AssetBattery
  /** Picture uploaded for the device in Traccar, served through this app (see images.server.ts). */
  imageUrl?: string
  /** The places (lib/places.ts) its latest position is inside. */
  placeIds: number[]
}

/** First letter of the name, shown when there's no picture. */
export function assetInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

/** A location older than this is shown greyed out. */
const STALE_AFTER_MS = 30 * 60 * 1000

export function isStale(asset: Asset, now: number): boolean {
  return !asset.location || now - Date.parse(asset.location.fixTime) > STALE_AFTER_MS
}

/** True when the tracker has been in contact since its last location fix (e.g. no GPS indoors). */
export function contactIsNewerThanFix(asset: Asset): boolean {
  if (!asset.lastUpdate || !asset.location) return false
  return Date.parse(asset.lastUpdate) - Date.parse(asset.location.fixTime) > 5 * 60 * 1000
}

export function statusLabel(status: Asset['status']): string {
  if (status === 'online') return 'Online'
  if (status === 'offline') return 'Offline'
  return 'No recent contact'
}
