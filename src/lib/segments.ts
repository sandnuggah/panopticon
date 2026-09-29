import type { TrailPoint } from './trail'

// Splits a trail into what the asset was doing: moving on foot, staying in one place, riding a
// vehicle, or travelling underground. It uses only the tracker's own reports (speed between GPS
// fixes, gaps without a fix, and cell tower changes), so it works anywhere without map data.
// Thresholds were tuned on a real SinoTrack ST-904L trip by metro across Stockholm; see
// ARCHITECTURE.md. This module has no runtime imports, so Node can run its tests directly.

/** Averaging this fast between two fixes, it can't be a dog on foot. */
const VEHICLE_KMH = 20
/** ...but only over at least this distance, so GPS jitter never looks like a ride. */
const VEHICLE_MIN_METERS = 150
/** A GPS gap that ends at least this far away, at least this fast, was travel without GPS. */
const GAP_MIN_METERS = 300
const GAP_MIN_KMH = 10
/** A pause between two rides this short and this still is the vehicle stopping (a station). */
const STOP_MAX_MS = 2 * 60 * 1000
const STOP_MAX_METERS = 100
/** A stay: at least this long within this distance of where it started. */
const STAY_MIN_MS = 2 * 60 * 1000
const STAY_MAX_METERS = 40
/** Stays are drawn at least this big, so a single spot still shows. */
const STAY_MIN_RADIUS_METERS = 10
/** Stays this close (edge to edge) are one place, if the moves between them stayed this near. */
const PLACE_GAP_METERS = 25
const WANDER_METERS = 50
/** Live activity only counts while reports are this fresh. */
const ACTIVITY_MAX_AGE_MS = 3 * 60 * 1000
/** Underground right now: this long without a fix while switching between this many cell sites. */
const UNDERGROUND_MIN_MS = 60 * 1000
const UNDERGROUND_MIN_SITES = 3

export type LatLon = { lat: number; lon: number }

export type TrailPiece =
  /** On foot: the GPS fixes in order. */
  | { kind: 'move'; points: TrailPoint[] }
  /** In one place for a while: where, and roughly how big an area. */
  | { kind: 'stay'; center: LatLon; radius: number; from: number; to: number }
  /** Riding: from the last fix before to the first fix after. */
  | { kind: 'vehicle' | 'underground'; from: TrailPoint; to: TrailPoint }

export type Activity = 'vehicle' | 'underground'

/** Staying put right now: since when, and whether that's when it began or only when the points do. */
export type Stay = { since: number; began: boolean }

/** Great-circle distance in metres. */
export function distance(a: LatLon, b: LatLon): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

type HopKind = 'walk' | 'vehicle' | 'underground'

/** One step between two consecutive GPS fixes, with the reports without a fix in between. */
type Hop = { from: TrailPoint; to: TrailPoint; kind: HopKind }

/** The trail as pieces, oldest first. Reports without a fix only count as evidence, never as positions. */
export function classifyTrail(points: TrailPoint[]): TrailPiece[] {
  const hops = toHops(points)
  if (hops.length === 0) {
    const fixes = points.filter((point) => point.valid)
    return fixes.length > 0 ? [toStay(fixes)] : []
  }
  const pieces: TrailPiece[] = []
  for (const stretch of toStretches(hops)) {
    if (stretch.kind === 'walk') pieces.push(...splitWalk(stretch.points))
    else pieces.push({ kind: stretch.kind, from: stretch.points[0]!, to: stretch.points.at(-1)! })
  }
  return pieces
}

/**
 * Whether the asset is staying in one place right now (the trail ends in a stay, with recent
 * reports), and since when. `began` is false when the stay goes back to the first point given,
 * so it may have begun earlier.
 */
export function currentStay(points: TrailPoint[], now: number): Stay | null {
  const latest = points.at(-1)
  if (!latest || now - latest.time > ACTIVITY_MAX_AGE_MS) return null
  const last = classifyTrail(points).at(-1)
  if (last?.kind !== 'stay') return null
  const firstFix = points.find((point) => point.valid)!
  return { since: last.from, began: last.from > firstFix.time }
}

/**
 * What the asset is doing right now, if it's riding: from the latest reports, as of `now`. A ride
 * that ended moments ago still counts, since that's usually the vehicle stopping at a station.
 */
export function currentActivity(points: TrailPoint[], now: number): Activity | null {
  const latest = points.at(-1)
  if (!latest || now - latest.time > ACTIVITY_MAX_AGE_MS) return null

  // Underground now: reports keep coming without a fix while the tracker moves between cell sites.
  // (Indoors the tracker also loses its fix, but stays with the same site.)
  const lastFix = points.findLastIndex((point) => point.valid)
  const withoutFix = points.slice(lastFix + 1)
  if (withoutFix.length >= 2 && withoutFix.at(-1)!.time - withoutFix[0]!.time >= UNDERGROUND_MIN_MS) {
    if (cellSites([points[lastFix], ...withoutFix]) >= UNDERGROUND_MIN_SITES) return 'underground'
  }

  const pieces = classifyTrail(points)
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!
    // Anything longer than a station stop since the ride means it's over.
    if (piece.kind === 'move') {
      if (now - piece.points[0]!.time > STOP_MAX_MS) return null
    } else if (piece.kind === 'stay') {
      if (now - piece.from > STOP_MAX_MS) return null
    } else {
      return now - piece.to.time <= STOP_MAX_MS ? piece.kind : null
    }
  }
  return null
}

function toHops(points: TrailPoint[]): Hop[] {
  const hops: Hop[] = []
  let from: TrailPoint | undefined
  let gap: TrailPoint[] = []
  for (const point of points) {
    if (!point.valid) {
      if (from) gap.push(point)
      continue
    }
    if (from && point.time > from.time) {
      const meters = distance(from, point)
      const kmh = (meters / ((point.time - from.time) / 1000)) * 3.6
      let kind: HopKind = 'walk'
      if (kmh >= VEHICLE_KMH && meters >= VEHICLE_MIN_METERS) kind = gap.length > 0 ? 'underground' : 'vehicle'
      else if (gap.length > 0 && meters >= GAP_MIN_METERS && kmh >= GAP_MIN_KMH) kind = 'underground'
      hops.push({ from, to: point, kind })
    }
    if (!from || point.time > from.time) from = point
    gap = []
  }
  return hops
}

type Stretch = { kind: HopKind; points: TrailPoint[] }

/**
 * Neighbouring hops of the same family join: walking with walking, and vehicle with underground
 * into one ride (underground if any part was). A short, still pause between two rides joins the ride.
 */
function toStretches(hops: Hop[]): Stretch[] {
  const riding = hops.map((hop) => hop.kind !== 'walk')
  let i = 0
  while (i < hops.length) {
    if (riding[i]) {
      i++
      continue
    }
    let j = i
    while (j < hops.length && !riding[j]) j++
    const between = i > 0 && j < hops.length
    const pause = { ms: hops[j - 1]!.to.time - hops[i]!.from.time, meters: distance(hops[i]!.from, hops[j - 1]!.to) }
    if (between && pause.ms <= STOP_MAX_MS && pause.meters <= STOP_MAX_METERS) riding.fill(true, i, j)
    i = j
  }

  const stretches: Stretch[] = []
  hops.forEach((hop, index) => {
    const kind: HopKind = riding[index] ? (hop.kind === 'walk' ? 'vehicle' : hop.kind) : 'walk'
    const last = stretches.at(-1)
    if (last && (last.kind === 'walk') === (kind === 'walk')) {
      last.points.push(hop.to)
      if (kind === 'underground') last.kind = 'underground'
    } else {
      stretches.push({ kind, points: [hop.from, hop.to] })
    }
  })
  return stretches
}

type Part = { stay: boolean; points: TrailPoint[] }

/**
 * Splits walking into moves between stays. A move's ends touch the stays around it. Stays in one
 * place with only local wandering between them (a yard, a park) become one; see mergePlaces.
 */
function splitWalk(points: TrailPoint[]): TrailPiece[] {
  const parts: Part[] = []
  let move: TrailPoint[] = []
  let i = 0
  while (i < points.length) {
    let j = i
    while (j + 1 < points.length && distance(points[i]!, points[j + 1]!) <= STAY_MAX_METERS) j++
    if (points[j]!.time - points[i]!.time >= STAY_MIN_MS) {
      move.push(points[i]!)
      if (move.length > 1) parts.push({ stay: false, points: move })
      parts.push({ stay: true, points: points.slice(i, j + 1) })
      move = [points[j]!]
      i = j + 1
    } else {
      move.push(points[i]!)
      i++
    }
  }
  if (move.length > 1) parts.push({ stay: false, points: move })

  return mergePlaces(parts).map((part) => (part.stay ? toStay(part.points) : { kind: 'move', points: part.points }))
}

/**
 * Pottering about one place (a yard, a park) gives many stays with short moves between them. Joins
 * two stays, and the move between them, when they're close and the move never strayed from them,
 * until nothing more joins; then moves that never left a neighbouring stay's circle join it too.
 */
function mergePlaces(parts: Part[]): Part[] {
  const merged = [...parts]
  for (let joined = true; joined; ) {
    joined = false
    for (let k = 0; k + 2 < merged.length; k++) {
      const [a, between, b] = [merged[k]!, merged[k + 1]!, merged[k + 2]!]
      if (a.stay && !between.stay && b.stay && samePlace(a.points, between.points, b.points)) {
        merged.splice(k, 3, { stay: true, points: [...a.points, ...between.points.slice(1, -1), ...b.points] })
        joined = true
      }
    }
  }
  for (let k = 0; k < merged.length; k++) {
    const part = merged[k]!
    if (part.stay) continue
    const neighbour = [merged[k - 1], merged[k + 1]].find(
      (other) => other?.stay && withinStay(toStay(other.points), part.points, 0),
    )
    if (!neighbour) continue
    const before = neighbour === merged[k - 1]
    neighbour.points = before ? [...neighbour.points, ...part.points.slice(1)] : [...part.points.slice(0, -1), ...neighbour.points]
    merged.splice(k, 1)
    k--
  }
  return merged
}

function samePlace(a: TrailPoint[], between: TrailPoint[], b: TrailPoint[]): boolean {
  const [stayA, stayB] = [toStay(a), toStay(b)]
  if (distance(stayA.center, stayB.center) > stayA.radius + stayB.radius + PLACE_GAP_METERS) return false
  return between.every((point) => withinStay(stayA, [point], WANDER_METERS) || withinStay(stayB, [point], WANDER_METERS))
}

/** Whether all these points lie inside the stay's circle, grown by `margin`. */
function withinStay(stay: StayPiece, points: TrailPoint[], margin: number): boolean {
  return points.every((point) => distance(stay.center, point) <= stay.radius + margin)
}

type StayPiece = Extract<TrailPiece, { kind: 'stay' }>

/** Where a stay was, and how big an area: 90% of the fixes lie within the radius, so one stray fix doesn't blow it up. */
function toStay(points: TrailPoint[]): StayPiece {
  const center = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
  }
  const distances = points.map((point) => distance(center, point)).sort((a, b) => a - b)
  const radius = Math.max(STAY_MIN_RADIUS_METERS, distances[Math.ceil(distances.length * 0.9) - 1]!)
  return { kind: 'stay', center, radius, from: points[0]!.time, to: points.at(-1)!.time }
}

/**
 * How many different cell sites (masts) the reports were served by. LTE cell IDs are the site's
 * ID times 256 plus the antenna, so neighbouring antennas on one mast count once.
 */
function cellSites(points: (TrailPoint | undefined)[]): number {
  const sites = new Set<number>()
  for (const point of points) {
    if (point?.cell !== undefined) sites.add(point.cell > 0xffff ? Math.floor(point.cell / 256) : point.cell)
  }
  return sites.size
}
