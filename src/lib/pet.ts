/** What the browser gets for each tracker. Built on the server from a Traccar device and its latest position. */
export type Pet = {
  id: number
  name: string
  status: 'online' | 'offline' | 'unknown'
  /** Last contact from the tracker (ISO time), null if it has never connected. */
  lastUpdate: string | null
  /** Latest known location, null until the tracker's first position. */
  location: {
    lat: number
    lon: number
    /** Metres, when the tracker reports it. */
    accuracy?: number
    /** When the pet was at this location (ISO time). */
    fixTime: string
  } | null
  /** Only present when the tracker reports battery. */
  battery?: {
    percent?: number
    volts?: number
  }
}
