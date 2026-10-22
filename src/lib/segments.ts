import type { TrailPoint } from './trail'

// Splits a trail into what the asset was doing: moving on foot, staying in one place, riding a
// vehicle, or travelling underground. It uses only the tracker's own reports (speed between GPS
// fixes, gaps without a fix, and cell tower changes), so it works anywhere without map data.
// Thresholds were tuned on real SinoTrack ST-904L trips: by metro across Stockholm, and a weekend
// with car rides in the country and a train into the city; see ARCHITECTURE.md. Those that depend on
// the tracker (how it reports, how far its fixes wander) are a TrailProfile, per kind of tracker (see
// lib/tracker.ts). This module has no runtime imports, so Node can run its tests directly.

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
/**
 * "Here since" holds after a stay until this many fixes are more than WANDER_METERS outside it: the
 * asset has left. One fix out, or pottering about nearby, was making it drop out and come back with the
 * same time once the asset settled again (44 times in a week of Kofi's, nearly all on walks in parks).
 */
const LEFT_FIXES = 2
/** On the map, a stop shorter than this is part of the walk (a dog sniffing), not a dot of its own. */
const SHORT_STOP_MS = 5 * 60 * 1000
/**
 * A lone fix at least this far from the fixes either side of it, all within SPIKE_MAX_MS, while
 * those two are much closer to each other (at most SPIKE_SHORTCUT of the way through it), went out
 * and straight back: GPS jumping among buildings or trees, not a trip down the street. It's left out.
 * A weak fix (see isWeak) may have its neighbours further apart, up to the tracker's silence
 * (SILENT_MS): indoors there are minutes without a fix around it. On a week of Kofi's that was one
 * fix, 96 m out from the courtyard behind home into the next block's and 123 m back, over 3.5 minutes.
 */
const SPIKE_MIN_METERS = 40
const SPIKE_SHORTCUT = 0.6
const SPIKE_MAX_MS = 3 * 60 * 1000
/**
 * A weak fix (see isWeak) after a gap in the fixes (the tracker's `gapMs`), at least this far from
 * the fix before the gap, is provisional, and so are the weak fixes after it that stay that far: GPS
 * finding itself again, as when an ST-904L at home put Kofi in the canal 320 m away (6 fixes, 4–7
 * satellites, the same position five times), then slept for 2.7 hours and woke up at home. A good fix
 * within CONFIRM_METERS of them confirms them, and so does a run of them (see WEAK_RUN_FIXES); a fix
 * back near where it was, a good one elsewhere, or none yet leaves them out. On a week of Kofi's:
 * that, the 5 weak fixes of a real outing at 7:28 one morning, and one arrival home, confirmed 30 s later.
 */
const UNCONFIRMED_METERS = 100
const CONFIRM_METERS = 50
/**
 * Weak fixes are GPS that has found itself, not wandering, once there are this many in a row, over
 * this long, without the tracker going silent (`silentMs`) between them, at this many positions this
 * far apart (GPS stuck repeats its position, or drifts by a metre or two). They confirm the fixes left
 * out as unconfirmed, and an asset leaves one of its places on them (see presence.ts). On a week of
 * Kofi's, that was one real outing, at 7:28 after a night's sleep with 5–7 satellites, moving 15 m over
 * its 5 fixes; not the canal, where GPS was stuck on one position five times.
 */
export const WEAK_RUN_FIXES = 4
export const WEAK_RUN_MS = 90 * 1000
export const WEAK_RUN_POSITIONS = 3
export const WEAK_RUN_METERS = 5
/** A fix this close to the one before is the same position: an ST-904L that's still, or stuck, repeats it to the centimetre. */
export const SAME_POSITION_METERS = 0.5
/** Live activity only counts while reports are this fresh. */
const ACTIVITY_MAX_AGE_MS = 3 * 60 * 1000
/**
 * An ST-904L stops reporting when it's still, so a stay goes on through silence, for up to this long
 * (a night and a day), until it reports again. Over a week of Kofi's, it was silent for 81% of the
 * time he was staying somewhere, so "Here since" showed for only 13% of it.
 */
const QUIET_MS = 24 * 60 * 60 * 1000
/** Fixes this far apart in time have a leg between them that nobody saw (see snap.ts). */
const GAP_MS = 2 * 60 * 1000
/**
 * A fix with fewer satellites than this is weak. Measured on a week of an ST-904L's walks: from 10
 * satellites up, 90% of fixes lie within 7–14 m of the line between their neighbours; below, 20–48 m,
 * and 16 of the week's 18 hops of 60 m or more within walks started or ended at one.
 */
const WEAK_SATELLITES = 10
/**
 * An asset has left one of its places once its fixes are this far outside it, and settled there once
 * they're this close (see presence.ts): Home's edge is no wall, and indoors an ST-904L's fixes wander
 * 15–25 m past it. On a week of Kofi's at a 50 m Home, his trips to the park's edge 70–85 m out count.
 */
const PLACE_MARGIN_METERS = 15

/**
 * How the trail reads one kind of tracker's reports (see TRAIL_PROFILES in lib/tracker.ts): the
 * thresholds above that depend on how it reports and how far its fixes wander.
 */
export type TrailProfile = {
  /** SILENT_MS */
  silentMs: number
  /** STAY_MAX_METERS */
  stayMeters: number
  /** SPIKE_MIN_METERS, SPIKE_MAX_MS */
  spikeMeters: number
  spikeMs: number
  /** ACTIVITY_MAX_AGE_MS */
  freshMs: number
  /** GAP_MS */
  gapMs: number
  /** QUIET_MS, for a tracker that stops reporting when still; without, a stay needs fresh reports (`freshMs`). */
  quietMs?: number
  /** A fix is weak (see isWeak) with fewer satellites than this, or said to be off by more than this many metres. */
  weakSatellites?: number
  weakAccuracyMeters?: number
  /** PLACE_MARGIN_METERS */
  placeMarginMeters: number
}

/** The thresholds as tuned on a SinoTrack ST-904L. */
export const DEFAULT_TRAIL_PROFILE: TrailProfile = {
  silentMs: SILENT_MS,
  stayMeters: STAY_MAX_METERS,
  spikeMeters: SPIKE_MIN_METERS,
  spikeMs: SPIKE_MAX_MS,
  freshMs: ACTIVITY_MAX_AGE_MS,
  gapMs: GAP_MS,
  quietMs: QUIET_MS,
  weakSatellites: WEAK_SATELLITES,
  placeMarginMeters: PLACE_MARGIN_METERS,
}

/**
 * Whether a fix is weak: GPS barely had it (indoors, among buildings), so it may be tens of metres off,
 * and where it is can't be trusted to say which way the asset went (see matchableWalks). It stays on
 * the trail: weak fixes come in runs, so leaving them out leaves the same jump.
 */
export function isWeak(point: TrailPoint, profile: TrailProfile): boolean {
  if (profile.weakSatellites !== undefined && point.satellites !== undefined && point.satellites < profile.weakSatellites) return true
  return profile.weakAccuracyMeters !== undefined && point.accuracy !== undefined && point.accuracy > profile.weakAccuracyMeters
}
/** Underground right now: this long without a fix while switching between this many cell sites. */
const UNDERGROUND_MIN_MS = 60 * 1000
const UNDERGROUND_MIN_SITES = 3

export type LatLon = { lat: number; lon: number }

/**
 * One of the asset's places (Home, Daycare), for drawing: stays inside it are one dot at `center`.
 * `within` says whether a point is inside it, or at most `margin` metres outside.
 */
/**
 * A visit to one of the asset's places, as presence has it (see presence.ts): from its first fix to
 * the first fix out (null: there still), drawn as one stay at `center` (the place's way in, or middle).
 */
export type PlaceStay = { from: number; to: number | null; center: LatLon }

export type TrailPiece =
  /** On foot: the GPS fixes in order. */
  | { kind: 'move'; points: TrailPoint[] }
  /** In one place for a while: where, and roughly how big an area. `atPlace`: at one of the asset's places, at its middle. */
  | { kind: 'stay'; center: LatLon; radius: number; from: number; to: number; atPlace?: boolean }
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
 * home on two days) joins it, whenever it was; the dot is at the longest stay of its group, or at one of
 * the asset's places, and fades by the latest. Returns the dots and, for each stay, the index of its
 * dot, so the walks can run to it. This is only for drawing: the trail keeps each visit, so "Here
 * since" is the current one.
 */
export function stayDots(stays: { center: LatLon; from: number; to: number; atPlace?: boolean }[]): { dots: StayDot[]; dotOf: number[] } {
  const dots: StayDot[] = []
  const dotOf: number[] = []
  const length = (index: number) => stays[index]!.to - stays[index]!.from
  const rank = (index: number) => (stays[index]!.atPlace ? 1 : 0)
  const longestFirst = stays.map((_, index) => index).sort((a, b) => rank(b) - rank(a) || length(b) - length(a))
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
 * The trail as pieces, oldest first, as the map draws it, the card reads it and Stats counts it.
 * Reports without a fix only count as evidence, never as positions. Pottering about one place (a
 * park) is the walking about between its stops, which are joined only across blips; stops shorter
 * than SHORT_STOP_MS are part of the walk. `visits`: the asset's visits to its places, each one stay
 * of all the points in it, however its fixes wander, and however short (see splitWalk). `profile`:
 * the tracker's (see TrailProfile).
 */
export function classifyTrail(
  points: TrailPoint[],
  { visits = [], profile = DEFAULT_TRAIL_PROFILE }: { visits?: PlaceStay[]; profile?: TrailProfile } = {},
): TrailPiece[] {
  const kept = withoutSpikes(withoutUnconfirmed(points, profile), profile)
  const hops = toHops(kept, profile, visits)
  if (hops.length === 0) {
    // A fix or so: where it is, without those left out.
    const fixes = kept.filter((point) => point.valid)
    return fixes.length > 0 ? [toStay(fixes)] : []
  }
  const pieces: TrailPiece[] = []
  for (const stretch of toStretches(hops)) {
    if (stretch.kind === 'walk') pieces.push(...splitWalk(stretch.points, visits, profile))
    else if (stretch.kind !== 'gap') {
      pieces.push({ kind: stretch.kind, from: stretch.points[0]!, to: stretch.points.at(-1)!, legs: stretch.legs })
    }
  }
  return pieces
}

/**
 * Whether the asset is staying in one place right now, as the map has it (the trail ends in a stop of
 * SHORT_STOP_MS or more, a dot, with recent reports, or a tracker that stops reporting when still has
 * been quiet since; see QUIET_MS), and since when; it holds until the asset has clearly left (see
 * LEFT_FIXES). At one of its places, where it is goes by its presence instead (see presence.ts).
 * `began` is false when the stay goes back to the first point given, so it may have begun earlier.
 */
export function currentStay(points: TrailPoint[], now: number, profile = DEFAULT_TRAIL_PROFILE): Stay | null {
  const latest = points.at(-1)
  if (!latest || now - latest.time > (profile.quietMs ?? profile.freshMs)) return null
  const pieces = classifyTrail(points, { profile })
  const [before, last] = [pieces.at(-2), pieces.at(-1)]
  let stay = last?.kind === 'stay' ? last : null
  // Not left yet: a move since the stay that hasn't got clearly away from it (see LEFT_FIXES).
  if (last?.kind === 'move' && before?.kind === 'stay') {
    const away = last.points.slice(1).filter((point) => !withinStay(before, [point], WANDER_METERS))
    if (away.length < LEFT_FIXES) stay = before
  }
  if (!stay) return null
  const firstFix = points.find((point) => point.valid)!
  return { since: stay.from, began: stay.from > firstFix.time }
}

/**
 * What the asset is doing right now, if it's riding: from the latest reports, as of `now`. A ride
 * that ended moments ago still counts, since that's usually the vehicle stopping at a station.
 */
export function currentActivity(points: TrailPoint[], now: number, profile = DEFAULT_TRAIL_PROFILE): Activity | null {
  const latest = points.at(-1)
  if (!latest || now - latest.time > profile.freshMs) return null

  // Underground now: reports keep coming without a fix while the tracker moves between cell sites.
  // (Indoors the tracker also loses its fix, but stays with the same site.)
  const lastFix = points.findLastIndex((point) => point.valid)
  const withoutFix = points.slice(lastFix + 1)
  if (withoutFix.length >= 2 && withoutFix.at(-1)!.time - withoutFix[0]!.time >= UNDERGROUND_MIN_MS) {
    if (cellSites([points[lastFix], ...withoutFix]) >= UNDERGROUND_MIN_SITES) return 'underground'
  }

  const pieces = classifyTrail(points, { profile })
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

/**
 * The asset's latest fix that can be trusted (see UNCONFIRMED_METERS), for where to show it: not one
 * GPS has yet to confirm.
 */
export function lastConfirmedFix(points: TrailPoint[], profile = DEFAULT_TRAIL_PROFILE): TrailPoint | undefined {
  return withoutUnconfirmed(points, profile).findLast((point) => point.valid)
}

/** The points without fixes GPS didn't confirm (see UNCONFIRMED_METERS). */
function withoutUnconfirmed(points: TrailPoint[], profile: TrailProfile): TrailPoint[] {
  const unconfirmed = new Set<TrailPoint>()
  let trusted: TrailPoint | undefined
  let previous: TrailPoint | undefined
  let provisional: TrailPoint[] = []
  // The different positions among them, as many as it takes (see WEAK_RUN_POSITIONS).
  let positions: TrailPoint[] = []
  for (const fix of points) {
    if (!fix.valid) continue
    const weak = isWeak(fix, profile)
    const far = weak && trusted !== undefined && distance(trusted, fix) >= UNCONFIRMED_METERS
    if (provisional.length > 0 && far && fix.time - previous!.time >= profile.silentMs) {
      // After a silence, a run starts again: GPS stuck before a night and a fix on waking aren't one.
      for (const point of provisional) unconfirmed.add(point)
      ;[provisional, positions] = [[fix], [fix]]
    } else if (provisional.length > 0) {
      if (far) {
        provisional.push(fix)
        if (positions.length < WEAK_RUN_POSITIONS && positions.every((other) => distance(other, fix) > WEAK_RUN_METERS)) positions.push(fix)
        const run = provisional.length >= WEAK_RUN_FIXES && fix.time - provisional[0]!.time >= WEAK_RUN_MS
        if (run && positions.length >= WEAK_RUN_POSITIONS) [provisional, positions, trusted] = [[], [], fix]
      } else {
        if (weak || distance(provisional.at(-1)!, fix) > CONFIRM_METERS) for (const point of provisional) unconfirmed.add(point)
        ;[provisional, positions, trusted] = [[], [], fix]
      }
    } else if (far && previous && fix.time - previous.time >= profile.gapMs) {
      ;[provisional, positions] = [[fix], [fix]]
    } else trusted = fix
    previous = fix
  }
  // Not confirmed yet: left out until a good fix is.
  for (const point of provisional) unconfirmed.add(point)
  return unconfirmed.size > 0 ? points.filter((point) => !unconfirmed.has(point)) : points
}

/** The points without GPS spikes (see SPIKE_MIN_METERS). */
function withoutSpikes(points: TrailPoint[], profile: TrailProfile): TrailPoint[] {
  const fixes = points.filter((point) => point.valid)
  const spikes = new Set<TrailPoint>()
  let before: TrailPoint | undefined
  fixes.forEach((fix, index) => {
    const after = fixes[index + 1]
    if (before && after && isSpike(before, fix, after, profile)) spikes.add(fix)
    else before = fix
  })
  return spikes.size > 0 ? points.filter((point) => !spikes.has(point)) : points
}

function isSpike(before: TrailPoint, fix: TrailPoint, after: TrailPoint, profile: TrailProfile): boolean {
  if (after.time - before.time > (isWeak(fix, profile) ? profile.silentMs : profile.spikeMs)) return false
  const [out, back] = [distance(before, fix), distance(fix, after)]
  return out >= profile.spikeMeters && back >= profile.spikeMeters && distance(before, after) <= SPIKE_SHORTCUT * (out + back)
}

function toHops(points: TrailPoint[], profile: TrailProfile, visits: PlaceStay[] = []): Hop[] {
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
      // At one of its places all along, as presence has it (waking up off where it slept indoors), or
      // leaving it on waking up, but not too fast for a walk (driven off, with no fix on the way).
      const there = visitAt(visits, from)
      if (there && (visitAt(visits, point) === there || (point.time === there.to && kmh < VEHICLE_KMH))) kind = 'walk'
      else if (silence > profile.silentMs) {
        // Silent: still in the same place (walking, so a stay), a ride if it got there fast, or unknown.
        if (meters > profile.stayMeters) kind = kmh >= VEHICLE_KMH ? 'vehicle' : 'gap'
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

/** `place`: a visit to one of the asset's places; `until`: when it ended, after its last fix (asleep there). */
type Part = { stay: boolean; points: TrailPoint[]; place?: PlaceStay; until?: number }

/**
 * Splits walking into moves between stays. A move's ends touch the stays around it. A visit to one
 * of the asset's places is a stay of all its points, from the first fix that showed it to the last
 * before it left, so its dot is where presence says the asset is: the fixes indoors that wander tens
 * of metres, and a trip to the pee spot too short to leave by, are part of it, and a walk out begins
 * with the fix it left on, however near. Stays at one spot with a blip between them become one (see
 * mergePlaces); short stops are part of the walk.
 */
function splitWalk(points: TrailPoint[], visits: PlaceStay[], profile: TrailProfile): TrailPiece[] {
  const visitOf = (point: TrailPoint) => visitAt(visits, point)
  const parts: Part[] = []
  let move: TrailPoint[] = []
  let i = 0
  const stay = (j: number, place?: PlaceStay) => {
    move.push(points[i]!)
    if (move.length > 1) parts.push({ stay: false, points: move })
    // Asleep at a place until it left: there until the fix it left on, where the walk out begins.
    const next = points[j + 1]
    const slept = place && next && next.time - points[j]!.time >= profile.silentMs
    parts.push({ stay: true, points: points.slice(i, j + 1), place, until: slept ? next.time : undefined })
    move = slept ? [] : [points[j]!]
    i = j + 1
  }
  while (i < points.length) {
    const visit = visitOf(points[i]!)
    let j = i
    if (visit) {
      while (j + 1 < points.length && visitOf(points[j + 1]!) === visit) j++
      stay(j, visit)
      continue
    }
    const free = (k: number) => k < points.length && !visitOf(points[k]!)
    while (free(j + 1) && distance(points[i]!, points[j + 1]!) <= profile.stayMeters) j++
    if (points[j]!.time - points[i]!.time >= STAY_MIN_MS) {
      // The middle of the fixes it began with, kept as it is: a middle that moved with each new fix
      // would follow a slow walk away.
      const middle = centre(points.slice(i, j + 1))
      while (free(j + 1) && distance(middle, points[j + 1]!) <= profile.stayMeters) j++
      stay(j)
    } else {
      move.push(points[i]!)
      i++
    }
  }
  if (move.length > 1) parts.push({ stay: false, points: move })

  return joinShortStops(mergePlaces(parts)).map((part) =>
    part.stay ? toStay(part.points, part.place, part.until) : { kind: 'move', points: part.points },
  )
}

/** The visit a point is in, if any: from its first fix to before the first fix out. */
function visitAt(visits: PlaceStay[], point: TrailPoint): PlaceStay | undefined {
  return visits.find((visit) => point.time >= visit.from && (visit.to === null || point.time < visit.to))
}

/**
 * For drawing: stops shorter than SHORT_STOP_MS become part of the walk around them, so a walk with
 * a dog that keeps stopping to sniff is one path, snapped as one, not pieces between dots.
 */
function joinShortStops(parts: Part[]): Part[] {
  const joined: Part[] = []
  for (const part of parts) {
    // A stop at one of the asset's places is a stop there, however short: walks home end at its dot.
    const short = part.stay && !part.place && part.points.at(-1)!.time - part.points[0]!.time < SHORT_STOP_MS
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
 * Joins two stays, and the move between them, across a move of a fix or two (GPS noise) when they're
 * at the same spot, where they'd share a dot (see stayDots) anyway, and the move never strayed from
 * them, until nothing more joins; then moves that never left a neighbouring stay's circle join it too.
 */
function mergePlaces(parts: Part[]): Part[] {
  const merged = [...parts]
  for (let joined = true; joined;) {
    joined = false
    for (let k = 0; k + 2 < merged.length; k++) {
      const [a, between, b] = [merged[k]!, merged[k + 1]!, merged[k + 2]!]
      const blip = () => between.points.length - 2 <= BLIP_FIXES && distance(centre(a.points), centre(b.points)) <= STAY_DOT_JOIN_METERS
      // Not a visit to a place: presence has said where it was.
      const free = !a.place && !b.place
      if (a.stay && !between.stay && b.stay && free && blip() && samePlace(a.points, between.points, b.points)) {
        merged.splice(k, 3, { stay: true, points: [...a.points, ...between.points.slice(1, -1), ...b.points] })
        joined = true
      }
    }
  }
  for (let k = 0; k < merged.length; k++) {
    const part = merged[k]!
    const around = [merged[k - 1], merged[k + 1]]
    // A walk to or from a visit to a place is one: presence has said it left, or came.
    if (part.stay || around.some((other) => other?.place)) continue
    const neighbour = around.find((other) => other?.stay && withinStay(toStay(other.points), part.points, 0))
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

/**
 * Where a stay was, and how big an area: 90% of the fixes lie within the radius, so one stray fix
 * doesn't blow it up. At one of the asset's places, it's at the place's middle.
 */
function toStay(points: TrailPoint[], place?: PlaceStay, until?: number): StayPiece {
  const center = centre(points)
  const distances = points.map((point) => distance(center, point)).sort((a, b) => a - b)
  const radius = Math.max(STAY_MIN_RADIUS_METERS, distances[Math.ceil(distances.length * 0.9) - 1]!)
  const stay: StayPiece = { kind: 'stay', center, radius, from: points[0]!.time, to: until ?? points.at(-1)!.time }
  return place ? { ...stay, center: place.center, atPlace: true } : stay
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
