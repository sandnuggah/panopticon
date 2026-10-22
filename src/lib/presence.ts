import type { AssetLocation } from './asset.ts'
import { areaSize, placeCenter, withinArea, type Place } from './places.ts'
import {
  currentStay,
  distance,
  isWeak,
  lastConfirmedFix,
  SAME_POSITION_METERS,
  WEAK_RUN_FIXES,
  WEAK_RUN_METERS,
  WEAK_RUN_MS,
  WEAK_RUN_POSITIONS,
  type PlaceStay,
  type Stay,
  type TrailProfile,
} from './segments.ts'
import { trailProfile, type TrackerKind } from './tracker.ts'
import { stayPoints, type TrailLength, type TrailPoint, type Trails } from './trail.ts'

// Whether an asset is at one of its places (Home), one state per place, which the marker, its badge,
// the details card, the "left Home" banners and the map's stays there all go by. Traccar says which
// places each position is inside, but one fix at a time: an ST-904L's fixes indoors wander tens of
// metres, and on a week of Kofi's, Home's edge was crossed 115 times by Traccar's account, 40 of them
// undone within 3 minutes, for some 34 real outings. Here an asset leaves only when the fixes clearly
// have, and arrives when they clearly do; a report without a fix never changes where it is, and
// neither does silence, except that a tracker going quiet near a place has arrived there (see
// quietAfter). No runtime imports beyond lib, so Node can run the tests.

/**
 * An asset left a place once this many fixes in a row were more than the profile's
 * `placeMarginMeters` outside it, with this many of them good (see isWeak: weak fixes indoors wander
 * out and back), or once weak ones made a run (see WEAK_RUN_FIXES in segments.ts). For a tracker that
 * stops reporting when still, a run outside starts again after a silence of its `silentMs`: fixes out
 * an hour apart (indoors at night) aren't a walk. One that reports on its own interval (a phone,
 * every 10 minutes) is never silent like that.
 */
const LEAVE_FIXES = 2
const LEAVE_GOOD_FIXES = 2
/**
 * A fix this far from the one before, at over this speed, isn't one an asset on foot walked to: one
 * inside isn't a good fix inside on its own (a car going by), unless the next one is near the place
 * too. A first fix out like that, but under TRAVEL_METERS from the last one in, is a jump, as GPS
 * makes: it has left once the fixes after it go on JUMP_METERS further away (driving off), or keep
 * moving out there (new positions) for LEAVE_HOLD_MS; not on fixes stuck on one position, and a run
 * that began with one starts again after the tracker's `gapMs` without a fix (as on 16/10 at Kofi's:
 * 150 m out, back to 87 m, stuck there, then asleep; and 21/10 15:44: 131 m, then stuck at 153 m).
 * Further than TRAVEL_METERS, it's travel nobody saw (driven off, with no fix on the way).
 */
const JUMP_METERS = 60
const JUMP_KMH = 10
const TRAVEL_METERS = 300
const LEAVE_HOLD_MS = 3 * 60 * 1000
/** It arrived with this many fixes in a row inside, or one good one... */
const ARRIVE_FIXES = 2
/**
 * ...or after settling within the margin: still (its latest fixes within this of the newest; an
 * ST-904L that's still repeats its position, and Kofi's still arrivals moved 0–6 m, while a slow
 * sniff along Home's edge went 5 m every 30 s) for this long, from the first of them; or the tracker
 * going quiet there (see quietAfter), from its first fix there.
 */
const STILL_METERS = 10
const SETTLED_MS = 2 * 60 * 1000
/**
 * A place bigger than a circle this wide (the biggest panopticon draws) is an area, not a spot, such
 * as a park or a block drawn in Traccar: the map doesn't draw a visit to it as one stay, so the walks
 * in it show (see placeStays).
 */
const SPOT_METERS = 100

/**
 * How long without a fix a tracker has gone quiet: one that stops reporting when still (`quietMs`,
 * an ST-904L), the profile's `gapMs` (indoors it loses its fix, or sleeps); one that reports all the
 * time, on its own interval (a phone, every few minutes), its `silentMs`.
 */
export function quietAfter(profile: TrailProfile): number {
  return profile.quietMs !== undefined ? profile.gapMs : profile.silentMs
}

/**
 * A stretch of time an asset was at one of its places: from when, backdated to the first fix that
 * showed it, to when it left (null: it's still there). `known`: false when it was there from the first
 * fix there is, so it may have come earlier.
 */
export type Visit = { place: number; from: number; to: number | null; known: boolean }

/**
 * Where an asset is as its places go: at `place` since `since`, or out (place null) since it left
 * `left` at `since`, or since its first fix when it hasn't been at one. `began`: false when that goes
 * back to the first fix there is.
 */
export type Presence = { place: number | null; since: number; began: boolean; left?: number }

/**
 * The asset's visits to its places, as its fixes show them as of `now` (see the rules above), oldest
 * first; of two that begin together (places that overlap), the bigger place first.
 */
export function placeVisits(points: TrailPoint[], places: Place[], assetId: number, profile: TrailProfile, now: number): Visit[] {
  const fixes = points.filter((point) => point.valid)
  const own = places.filter((place) => place.assetIds.includes(assetId))
  const size = new Map(own.map((place) => [place.id, areaSize(place.area)]))
  return own
    .flatMap((place) => visitsTo(place, fixes, profile, now))
    .sort((a, b) => a.from - b.from || size.get(b.place)! - size.get(a.place)!)
}

/** Where the asset is (see Presence) by its visits; null without a fix. */
export function presenceOf(points: TrailPoint[], visits: Visit[]): Presence | null {
  const first = points.find((point) => point.valid)
  if (!first) return null
  // At more than one (places that overlap): the one it came to last (the smaller, if together).
  const here = visits.filter((visit) => visit.to === null).at(-1)
  if (here) return { place: here.place, since: here.from, began: here.known }
  const left = visits
    .filter((visit) => visit.to !== null)
    .sort((a, b) => a.to! - b.to!)
    .at(-1)
  return left ? { place: null, since: left.to!, began: true, left: left.place } : { place: null, since: first.time, began: false }
}

/**
 * The asset's visits to its places as its trail draws them (see PlaceStay): one at a time, the one it
 * came to last while places overlap, each at the place's way in, or its middle without one; not to
 * places bigger than a spot (see SPOT_METERS). As of its latest point, or, `quiet`, of when its
 * tracker has been quiet long enough since its latest fix to have arrived where it went quiet (see
 * quietAfter), so the map draws it there when presence says so.
 */
export function placeStays(points: TrailPoint[], places: Place[], assetId: number, profile: TrailProfile, quiet = false): PlaceStay[] {
  const latest = points.at(-1)
  if (!latest) return []
  const spots = places.filter((place) => areaSize(place.area) <= Math.PI * SPOT_METERS ** 2)
  const visits = placeVisits(points, spots, assetId, profile, quiet ? Infinity : latest.time)
  const times = [...new Set(visits.flatMap((visit) => (visit.to === null ? [visit.from] : [visit.from, visit.to])))].sort((a, b) => a - b)
  const stays: (PlaceStay & { visit: Visit })[] = []
  times.forEach((time, index) => {
    const visit = visits.findLast((other) => other.from <= time && (other.to === null || time < other.to))
    if (!visit) return
    const to = times[index + 1] ?? visit.to
    const last = stays.at(-1)
    if (last?.visit === visit && last.to === time) last.to = to
    else {
      const place = places.find((candidate) => candidate.id === visit.place)!
      stays.push({ from: time, to, center: place.wayIn ?? placeCenter(place.area), visit })
    }
  })
  return stays.map(({ from, to, center }) => ({ from, to, center }))
}

/** Each asset's visits to its places (see placeVisits), as of `now`, with its kind of tracker's profile. */
export function assetVisits(
  trails: Trails,
  places: Place[],
  trackers: Record<number, TrackerKind | undefined>,
  now: number,
): Record<number, Visit[]> {
  const result: Record<number, Visit[]> = {}
  for (const [key, points] of Object.entries(trails))
    result[Number(key)] = placeVisits(points, places, Number(key), trailProfile(trackers[Number(key)]), now)
  return result
}

/**
 * Each asset's presence (see Presence), as of `now`, by its visits (see assetVisits). An asset without
 * a fix in its trail (quiet for longer than its history, a day and 3 hours, or not loaded yet) is at
 * the place its latest location is in, as far as anyone knows, since then at least.
 */
export function presences(
  trails: Trails,
  places: Place[],
  trackers: Record<number, TrackerKind | undefined>,
  now: number,
  assets: { id: number; location: AssetLocation | null }[] = [],
  visits = assetVisits(trails, places, trackers, now),
): Record<number, Presence> {
  const result: Record<number, Presence> = {}
  for (const [key, points] of Object.entries(trails)) {
    const presence = presenceOf(points, visits[Number(key)] ?? [])
    if (presence) result[Number(key)] = presence
  }
  for (const { id, location } of assets) {
    if (result[id] || !location) continue
    const place = places
      .filter((candidate) => candidate.assetIds.includes(id) && withinArea(candidate.area, location, 0))
      .sort((a, b) => areaSize(a.area) - areaSize(b.area))[0]
    if (place) result[id] = { place: place.id, since: Date.parse(location.fixTime), began: false }
  }
  return result
}

/** An arrival at a place or a departure from it, and when. */
export type News = { placeId: number; arrived: boolean; time: number }

/**
 * The departures and arrivals an asset's visits changing from `before` to `now` are news of ("Kofi
 * left Home"): a visit that was going on and has ended, from when it ended; and one that has begun
 * where nobody saw it come (`known`), from when it began. Not a visit that's gone (an arrival undone by
 * fixes that came late, a trail cut short by a long silence), nor one going on from the first fix
 * (the trail starts there); and of places inside others, each for itself.
 */
export function news(before: Visit[], now: Visit[]): News[] {
  const key = (visit: Visit) => `${visit.place} ${visit.from}`
  const was = new Map(before.map((visit) => [key(visit), visit]))
  return now.flatMap((visit): News[] => {
    const old = was.get(key(visit))
    if (old) return old.to === null && visit.to !== null ? [{ placeId: visit.place, arrived: false, time: visit.to }] : []
    return visit.to === null && visit.known ? [{ placeId: visit.place, arrived: true, time: visit.from }] : []
  })
}

/**
 * Where each asset is while it may have missed reports (back to the tab, a reconnect, until its
 * history has loaded again), as far as is known: as before, but out of the place it was at once a
 * location newer than its trail is outside it, by its margin, since then (the history will say more),
 * so the marker, its badge and the card agree. A location the trail has already is no news.
 */
export function whileLoading<A extends { id: number; location: AssetLocation | null; tracker?: TrackerKind }>(
  presence: Record<number, Presence>,
  assets: A[],
  places: Place[],
  trails: Trails,
): Record<number, Presence> {
  let result = presence
  for (const { id, location, tracker } of assets) {
    const here = presence[id]
    const place = here?.place != null ? places.find((candidate) => candidate.id === here.place) : undefined
    if (!place || !location || withinArea(place.area, location, trailProfile(tracker).placeMarginMeters)) continue
    const since = Date.parse(location.fixTime)
    if (since <= (trails[id]?.at(-1)?.time ?? -Infinity)) continue
    result = { ...result, [id]: { place: null, since, began: false, left: place.id } }
  }
  return result
}

/** One place's visits, by the rules above. */
function visitsTo(place: Place, fixes: TrailPoint[], profile: TrailProfile, now: number): Visit[] {
  const margin = profile.placeMarginMeters
  const inside = (fix: TrailPoint) => withinArea(place.area, fix, 0)
  const near = (fix: TrailPoint) => withinArea(place.area, fix, margin)
  const good = (fix: TrailPoint) => !isWeak(fix, profile)
  const visits: Visit[] = []
  // There, since when; the fixes outside in a row, how many of them good, the different positions
  // among them (as many as it takes), when the latest new position came, and the last one in, while
  // there; the fixes inside, and within the margin, in a row, while away.
  let at = null as { from: number; known: boolean } | null
  let out: TrailPoint[] = []
  let goodOut = 0
  let positions: TrailPoint[] = []
  let moved = 0
  let lastIn: TrailPoint | undefined
  let arriving: TrailPoint[] = []
  let settling: TrailPoint[] = []
  for (let index = 0; index < fixes.length; index++) {
    const fix = fixes[index]!
    const before = fixes[index - 1]
    if (!before) {
      if (near(fix)) [at, lastIn] = [{ from: fix.time, known: false }, fix]
      continue
    }
    if (at) {
      if (near(fix)) {
        ;[out, goodOut, positions, lastIn] = [[], 0, [], fix]
        continue
      }
      if (out.length > 0 && fix.time - out.at(-1)!.time >= restartAfter(out, lastIn, profile)) [out, goodOut, positions] = [[], 0, []]
      const previous = out.at(-1)
      if (!previous || distance(previous, fix) > SAME_POSITION_METERS) moved = fix.time
      out.push(fix)
      if (good(fix)) goodOut++
      if (positions.length < WEAK_RUN_POSITIONS && positions.every((other) => distance(other, fix) > WEAK_RUN_METERS)) positions.push(fix)
      if (!hasLeft(out, goodOut, positions.length, lastIn, moved)) continue
      visits.push({ place: place.id, from: at.from, to: out[0]!.time, known: at.known })
      ;[at, out, goodOut, positions, arriving, settling] = [null, [], 0, [], [], []]
      continue
    }
    arriving = inside(fix) ? [...arriving, fix] : []
    settling = near(fix) ? [...settling, fix] : []
    // Still: its latest fixes in the margin all close to the newest, for long enough.
    const stopped = settling[settling.findLastIndex((point) => distance(point, fix) > STILL_METERS) + 1]
    const still = stopped !== undefined && stopped !== fix && fix.time - stopped.time >= SETTLED_MS
    const quiet = (fixes[index + 1]?.time ?? now) - fix.time >= quietAfter(profile)
    // A good fix inside reached too fast, with this one near the place too.
    const cameIn = settling.length >= 2 && settling.at(-2) === before && inside(before) && good(before)
    const arrived =
      arriving.length >= ARRIVE_FIXES || (arriving.length > 0 && good(fix) && !jump(before, fix))
        ? arriving[0]
        : cameIn
          ? before
          : still
            ? stopped
            : settling.length > 0 && quiet
              ? settling[0]
              : undefined
    if (arrived) [at, lastIn, arriving, settling] = [{ from: arrived.time, known: true }, fix, [], []]
  }
  if (at) visits.push({ place: place.id, from: at.from, to: null, known: at.known })
  return visits
}

/**
 * How long without a fix starts a run outside again: for a tracker that stops reporting when still,
 * its `silentMs`, or its `gapMs` for a run that began with a jump (see TRAVEL_METERS); never for one
 * that reports on its own interval.
 */
function restartAfter(out: TrailPoint[], lastIn: TrailPoint | undefined, profile: TrailProfile): number {
  if (profile.quietMs === undefined) return Infinity
  return lastIn && gpsJump(lastIn, out[0]!) ? profile.gapMs : profile.silentMs
}

/**
 * Whether a run of fixes outside a place (see visitsTo), with this many good ones and different
 * positions among them, the latest new position at `moved`, is enough to have left it, by the rules
 * above.
 */
function hasLeft(out: TrailPoint[], goodOut: number, positions: number, lastIn: TrailPoint | undefined, moved: number): boolean {
  const [first, latest] = [out[0]!, out.at(-1)!]
  const goodRun = out.length >= LEAVE_FIXES && goodOut >= LEAVE_GOOD_FIXES
  const weakRun = out.length >= WEAK_RUN_FIXES && latest.time - first.time >= WEAK_RUN_MS && positions >= WEAK_RUN_POSITIONS
  if (!goodRun && !weakRun) return false
  if (!lastIn || !gpsJump(lastIn, first)) return true
  return distance(lastIn, latest) - distance(lastIn, first) >= JUMP_METERS || moved - first.time >= LEAVE_HOLD_MS
}

/** Whether a first fix out is a jump as GPS makes them (see TRAVEL_METERS). */
function gpsJump(lastIn: TrailPoint, first: TrailPoint): boolean {
  return jump(lastIn, first) && distance(lastIn, first) < TRAVEL_METERS
}

/** Whether a fix came too far, too fast, from the one before, for an asset on foot (see JUMP_METERS). */
function jump(from: TrailPoint, to: TrailPoint): boolean {
  const meters = distance(from, to)
  return meters >= JUMP_METERS && (meters / Math.max(1, (to.time - from.time) / 1000)) * 3.6 > JUMP_KMH
}

/**
 * Where the map shows an asset whose latest location is `location`, with its trail's `points` and
 * where it is (`presence`): at its place's centre while it's at one, so it sits still there however
 * its fixes wander indoors; else at its latest fix that GPS has confirmed (see lastConfirmedFix: weak
 * fixes after a night's sleep once they make a run, as presence leaves on), never the position a
 * report without a fix repeats. With when it last reported all the same. While the trail hasn't
 * caught up with it (reconnecting), as it is, but at the place's centre when it's there still.
 */
export function shownLocation<L extends AssetLocation>(
  location: L,
  points: TrailPoint[] | undefined,
  presence: Presence | undefined,
  places: Place[],
  profile: TrailProfile,
): L {
  const latest = points?.at(-1)
  const behind = !points || !latest || latest.time < Date.parse(location.fixTime)
  const place = presence?.place != null ? places.find((candidate) => candidate.id === presence.place) : undefined
  if (place && (!behind || withinArea(place.area, location, profile.placeMarginMeters))) {
    return { ...location, ...placeCenter(place.area), accuracy: undefined }
  }
  if (behind) return location
  const fix = lastConfirmedFix(points, profile)
  if (!fix || (fix.lat === location.lat && fix.lon === location.lon)) return location
  return { ...location, lat: fix.lat, lon: fix.lon, accuracy: undefined }
}

/** Each asset as the map shows it (see shownLocation); the same object when that's where it is. */
export function shownAssets<A extends { id: number; location: AssetLocation | null; tracker?: TrackerKind }>(
  assets: A[],
  trails: Trails,
  presence: Record<number, Presence>,
  places: Place[],
): A[] {
  return assets.map((asset) => {
    if (!asset.location) return asset
    const location = shownLocation(asset.location, trails[asset.id], presence[asset.id], places, trailProfile(asset.tracker))
    return location === asset.location ? asset : { ...asset, location }
  })
}

/**
 * Each asset staying put right now away from its places ("Here since", see currentStay), as of `now`:
 * on the points it goes by for this trail length (see stayPoints), with its kind of tracker's
 * profile. At one of its places, where it is goes by its presence instead; out since leaving one, a
 * stay begins after it left (`presence`).
 */
export function currentStays(
  trails: Trails,
  length: TrailLength,
  now: number,
  trackers: Record<number, TrackerKind | undefined>,
  presence: Record<number, Presence> = {},
): Record<number, Stay> {
  const stays: Record<number, Stay> = {}
  for (const [key, points] of Object.entries(trails)) {
    const id = Number(key)
    const where = presence[id]
    const left = where?.left !== undefined ? where.since : null
    const shown = stayPoints(points, length)
    const stay = currentStay(left === null ? shown : shown.filter((point) => point.time >= left), now, trailProfile(trackers[id]))
    if (!stay) continue
    // Begun since it left, which the points go back to: it's known when.
    stays[id] = left !== null && shown[0]!.time < left ? { ...stay, began: true } : stay
  }
  return stays
}
