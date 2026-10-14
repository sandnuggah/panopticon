import type { TrailPoint } from './trail'

// Splits a trail into what the asset was doing: moving on foot, staying in one place, riding a
// vehicle, or travelling underground. It uses only the tracker's own reports (speed between GPS
// fixes, gaps without a fix, and cell tower changes), so it works anywhere without map data.
// Thresholds were tuned on real SinoTrack ST-904L trips: by metro across Stockholm, and a weekend
// with car rides in the country and a train into the city; see ARCHITECTURE.md. This module has
// no runtime imports, so Node can run its tests directly.

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
/**
 * ...or, just as short, this fast on average: slower driving in traffic, or two reports seconds
 * apart. A ride also takes in hops this fast at its ends (setting off, arriving), when they cover at
 * least `RIDE_EDGE_MIN_METERS`, so the jitter of reports a second apart doesn't count.
 */
const RIDE_KEEP_KMH = 10
const RIDE_EDGE_MIN_METERS = 30
/**
 * No report at all for this long: the tracker was asleep (it sleeps when still) or out of reach.
 * That says nothing about GPS, so it's never evidence of being underground.
 */
const SILENT_MS = 10 * 60 * 1000
/**
 * A stay: at least this long within this distance of where it started; then it goes on while new
 * fixes are within this distance of the middle of those first fixes, so fixes that settle a little
 * off from where it started (arriving from the street, then wandering indoors) don't end it.
 */
const STAY_MIN_MS = 2 * 60 * 1000
const STAY_MAX_METERS = 40
/** Stays are drawn at least this big, so a single spot still shows. */
const STAY_MIN_RADIUS_METERS = 10
/** Stays whose middles are this close are drawn as one dot (see stayDots). */
const STAY_DOT_JOIN_METERS = 40
/** Stays this close (edge to edge) are one place, if the moves between them stayed this near. */
const PLACE_GAP_METERS = 25
const WANDER_METERS = 50
/** A move of at most this many fixes between two stays in one place is a blip (GPS noise), not wandering. */
const BLIP_FIXES = 2
/** On the map, a stop shorter than this is part of the walk (a dog sniffing), not a dot of its own. */
const SHORT_STOP_MS = 5 * 60 * 1000
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
  /**
   * Riding: from the last fix before to the first fix after, through the fixes on the way. Each
   * leg is with GPS or without (underground, drawn straight). The ride is what it was for most of
   * its time: a metro ride with stations in the open is underground, a train ending in a tunnel isn't.
   */
  | { kind: 'vehicle' | 'underground'; from: TrailPoint; to: TrailPoint; legs: RideLeg[] }

export type RideLeg = { kind: 'vehicle' | 'underground'; points: TrailPoint[] }

export type Activity = 'vehicle' | 'underground'

/** Staying put right now: since when, and whether that's when it began or only when the points do. */
export type Stay = { since: number; began: boolean }

/** A stay this long is a base (home, daycare, the office): the outings are between them. */
const BASE_STAY_MS = 20 * 60 * 1000

/**
 * When the asset's latest outing began, for drawing it in front of the older ones: the end of the
 * last stay of at least BASE_STAY_MS before its latest movement. Staying somewhere that long right
 * now ends that outing; it doesn't start a new one. Null when there's no such stay: it's all one outing.
 */
export function latestOutingStart(pieces: TrailPiece[]): number | null {
  const isBase = (piece: TrailPiece | undefined) => piece?.kind === 'stay' && piece.to - piece.from >= BASE_STAY_MS
  const end = isBase(pieces.at(-1)) ? pieces.length - 1 : pieces.length
  for (let index = end - 1; index >= 0; index--) {
    const piece = pieces[index]!
    if (piece.kind === 'stay' && isBase(piece)) return piece.to
  }
  return null
}

/** A dot drawn on the map for one or more stays (see stayDots): where, when last, and how long in all. */
export type StayDot = { center: LatLon; to: number; ms: number }

/**
 * Stays as dots on the map. A stay this close to a longer one's dot (back at the same place later,
 * home on two days) joins it, whenever it was; the dot is at the longest stay of its group and fades by
 * the latest. Returns the dots and, for each stay, the index of its dot, so the walks can run to it.
 * This is only for drawing: the trail keeps each visit, so "Here since" is the current one.
 */
export function stayDots(stays: { center: LatLon; from: number; to: number }[]): { dots: StayDot[]; dotOf: number[] } {
  const dots: StayDot[] = []
  const dotOf: number[] = []
  const longestFirst = stays.map((_, index) => index).sort((a, b) => stays[b]!.to - stays[b]!.from - (stays[a]!.to - stays[a]!.from))
  for (const index of longestFirst) {
    const stay = stays[index]!
    const near = dots.findIndex((dot) => distance(dot.center, stay.center) <= STAY_DOT_JOIN_METERS)
    if (near < 0) {
      dotOf[index] = dots.push({ center: stay.center, to: stay.to, ms: stay.to - stay.from }) - 1
    } else {
      const dot = dots[near]!
      dots[near] = { ...dot, to: Math.max(dot.to, stay.to), ms: dot.ms + stay.to - stay.from }
      dotOf[index] = near
    }
  }
  return { dots, dotOf }
}

/** Great-circle distance in metres. */
export function distance(a: LatLon, b: LatLon): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** `gap`: the tracker was silent and turned up somewhere else, too slowly to say how. Not drawn. */
type HopKind = 'walk' | 'vehicle' | 'underground' | 'gap'

/** One step between two consecutive GPS fixes, with the reports without a fix in between. */
type Hop = { from: TrailPoint; to: TrailPoint; kind: HopKind }

/**
 * The trail as pieces, oldest first. Reports without a fix only count as evidence, never as positions.
 * Pottering about one place (a yard, a park) is one stay, so "Here since" holds; `showWandering`, for
 * drawing, keeps the walking about as moves between its stops, and only joins stops across blips.
 */
export function classifyTrail(points: TrailPoint[], { showWandering = false } = {}): TrailPiece[] {
  const hops = toHops(points)
  if (hops.length === 0) {
    const fixes = points.filter((point) => point.valid)
    return fixes.length > 0 ? [toStay(fixes)] : []
  }
  const pieces: TrailPiece[] = []
  for (const stretch of toStretches(hops)) {
    if (stretch.kind === 'walk') pieces.push(...splitWalk(stretch.points, showWandering))
    else if (stretch.kind !== 'gap') {
      pieces.push({ kind: stretch.kind, from: stretch.points[0]!, to: stretch.points.at(-1)!, legs: stretch.legs })
    }
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
  // The longest wait between two reports of any kind since `from`.
  let previous: TrailPoint | undefined
  let silence = 0
  for (const point of points) {
    if (from && previous) silence = Math.max(silence, point.time - previous.time)
    previous = point
    if (!point.valid) {
      if (from) gap.push(point)
      continue
    }
    if (from && point.time > from.time) {
      const meters = distance(from, point)
      const kmh = (meters / ((point.time - from.time) / 1000)) * 3.6
      let kind: HopKind = 'walk'
      if (silence > SILENT_MS) {
        // Silent: still in the same place (walking, so a stay), a ride if it got there fast, or unknown.
        if (meters > STAY_MAX_METERS) kind = kmh >= VEHICLE_KMH ? 'vehicle' : 'gap'
      } else if (kmh >= VEHICLE_KMH && meters >= VEHICLE_MIN_METERS) kind = gap.length > 0 ? 'underground' : 'vehicle'
      else if (gap.length > 0 && meters >= GAP_MIN_METERS && kmh >= GAP_MIN_KMH) kind = 'underground'
      hops.push({ from, to: point, kind })
    }
    if (!from || point.time > from.time) {
      from = point
      silence = 0
    }
    gap = []
  }
  return hops
}

type Stretch = { kind: HopKind; points: TrailPoint[]; legs: RideLeg[] }

/**
 * Neighbouring hops of the same family join: walking with walking, vehicle with underground into
 * one ride, and gaps with gaps. A short pause between two rides joins the ride when it's still (a
 * station) or still fast (traffic, or two reports seconds apart), and so do fast hops at its ends.
 */
function toStretches(hops: Hop[]): Stretch[] {
  const riding = hops.map((hop) => hop.kind === 'vehicle' || hop.kind === 'underground')
  let i = 0
  while (i < hops.length) {
    if (hops[i]!.kind !== 'walk') {
      i++
      continue
    }
    let j = i
    while (j < hops.length && hops[j]!.kind === 'walk') j++
    if (i > 0 && riding[i - 1] && j < hops.length && riding[j]) {
      const ms = hops[j - 1]!.to.time - hops[i]!.from.time
      const meters = distance(hops[i]!.from, hops[j - 1]!.to)
      const kmh = (meters / (ms / 1000)) * 3.6
      if (ms <= STOP_MAX_MS && (meters <= STOP_MAX_METERS || kmh >= RIDE_KEEP_KMH)) riding.fill(true, i, j)
    }
    i = j
  }
  const keepsRiding = (hop: Hop) => {
    const meters = distance(hop.from, hop.to)
    return hop.kind === 'walk' && meters >= RIDE_EDGE_MIN_METERS && (meters / ((hop.to.time - hop.from.time) / 1000)) * 3.6 >= RIDE_KEEP_KMH
  }
  for (let k = 1; k < hops.length; k++) if (riding[k - 1] && !riding[k] && keepsRiding(hops[k]!)) riding[k] = true
  for (let k = hops.length - 2; k >= 0; k--) if (riding[k + 1] && !riding[k] && keepsRiding(hops[k]!)) riding[k] = true

  const family = (index: number) => (riding[index] ? 'ride' : hops[index]!.kind)
  const stretches: (Stretch & { family: string })[] = []
  hops.forEach((hop, index) => {
    const last = stretches.at(-1)
    const legKind = hop.kind === 'underground' ? 'underground' : 'vehicle'
    if (last && last.family === family(index)) {
      last.points.push(hop.to)
    } else {
      const kind: HopKind = riding[index] ? 'vehicle' : hop.kind
      stretches.push({ family: family(index), kind, points: [hop.from, hop.to], legs: [] })
    }
    if (!riding[index]) return
    const stretch = stretches.at(-1)!
    const leg = stretch.legs.at(-1)
    if (leg?.kind === legKind) leg.points.push(hop.to)
    else stretch.legs.push({ kind: legKind, points: [hop.from, hop.to] })
  })
  for (const stretch of stretches) {
    if (stretch.family !== 'ride') continue
    const time = (kind: RideLeg['kind']) =>
      stretch.legs.filter((leg) => leg.kind === kind).reduce((sum, leg) => sum + leg.points.at(-1)!.time - leg.points[0]!.time, 0)
    stretch.kind = time('underground') > time('vehicle') ? 'underground' : 'vehicle'
  }
  return stretches
}

type Part = { stay: boolean; points: TrailPoint[] }

/**
 * Splits walking into moves between stays. A move's ends touch the stays around it. Stays in one
 * place with only local wandering between them (a yard, a park) become one; see mergePlaces.
 */
function splitWalk(points: TrailPoint[], showWandering: boolean): TrailPiece[] {
  const parts: Part[] = []
  let move: TrailPoint[] = []
  let i = 0
  while (i < points.length) {
    let j = i
    while (j + 1 < points.length && distance(points[i]!, points[j + 1]!) <= STAY_MAX_METERS) j++
    if (points[j]!.time - points[i]!.time >= STAY_MIN_MS) {
      // The middle of the fixes it began with, kept as it is: a middle that moved with each new fix
      // would follow a slow walk away.
      const middle = centre(points.slice(i, j + 1))
      while (j + 1 < points.length && distance(middle, points[j + 1]!) <= STAY_MAX_METERS) j++
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

  const merged = mergePlaces(parts, showWandering)
  return (showWandering ? joinShortStops(merged) : merged).map((part) =>
    part.stay ? toStay(part.points) : { kind: 'move', points: part.points },
  )
}

/**
 * For drawing: stops shorter than SHORT_STOP_MS become part of the walk around them, so a walk with
 * a dog that keeps stopping to sniff is one path, snapped as one, not pieces between dots.
 */
function joinShortStops(parts: Part[]): Part[] {
  const joined: Part[] = []
  for (const part of parts) {
    const short = part.stay && part.points.at(-1)!.time - part.points[0]!.time < SHORT_STOP_MS
    const asMove = short ? { stay: false, points: part.points } : part
    const last = joined.at(-1)
    // Neighbouring parts share their end point.
    if (last && !last.stay && !asMove.stay)
      last.points = [...last.points, ...asMove.points.slice(last.points.at(-1) === asMove.points[0] ? 1 : 0)]
    else joined.push({ ...asMove, points: [...asMove.points] })
  }
  return joined
}

/**
 * Pottering about one place (a yard, a park) gives many stays with short moves between them. Joins
 * two stays, and the move between them, when they're close and the move never strayed from them,
 * until nothing more joins; then moves that never left a neighbouring stay's circle join it too.
 * With `blipsOnly`, for drawing, two stays only join across a move of a fix or two (GPS noise)
 * when they're at the same spot, where they'd share a dot (see stayDots) anyway.
 */
function mergePlaces(parts: Part[], blipsOnly: boolean): Part[] {
  const merged = [...parts]
  for (let joined = true; joined;) {
    joined = false
    for (let k = 0; k + 2 < merged.length; k++) {
      const [a, between, b] = [merged[k]!, merged[k + 1]!, merged[k + 2]!]
      const blip = () => between.points.length - 2 <= BLIP_FIXES && distance(centre(a.points), centre(b.points)) <= STAY_DOT_JOIN_METERS
      if (a.stay && !between.stay && b.stay && (!blipsOnly || blip()) && samePlace(a.points, between.points, b.points)) {
        merged.splice(k, 3, { stay: true, points: [...a.points, ...between.points.slice(1, -1), ...b.points] })
        joined = true
      }
    }
  }
  for (let k = 0; k < merged.length; k++) {
    const part = merged[k]!
    if (part.stay) continue
    const neighbour = [merged[k - 1], merged[k + 1]].find((other) => other?.stay && withinStay(toStay(other.points), part.points, 0))
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

/** The middle of some points: their average. */
function centre(points: TrailPoint[]): LatLon {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
  }
}

/** Where a stay was, and how big an area: 90% of the fixes lie within the radius, so one stray fix doesn't blow it up. */
function toStay(points: TrailPoint[]): StayPiece {
  const center = centre(points)
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
