// The trail replay: plays a tracker's real reports through the map's own code, in the order they
// arrived and with the app's 15-second clock, as if the map had been open all along, and scores how
// the trail behaves while you watch it. Every change to how the trail is worked out or drawn should
// keep the score or make it better (see ARCHITECTURE.md → Trail → The replay). Dev only.
//
//   npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>]
//     [--baseline <score.json>] [--json <score.json>] [--events]
//
// With MAP_MATCHING_URL set (a Valhalla, as for the app), Snap to paths is on, as in the browser.
//
// The fixture folder: Traccar positions as its API returns them (any .json file holding an array of
// them), the asset's places as Traccar geofences (geofences.json), and, if there are any, labels
// (labels.json): times of reports known to be GPS errors, or known to be real, as
// [{ "kind": "error" | "likely-error" | "real", "from": "<ISO time>", "to": "<ISO time>", "what": "…" }].
// It can be anywhere: real location data stays out of the repo. What this prints has times and
// metres, never positions.

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { isStale, type Asset } from '../src/lib/asset.ts'
import { applyUpdates } from '../src/lib/live.ts'
import { MAX_WALKS_PER_REQUEST, matchableWalks, type MatchablePoint } from '../src/lib/matching.ts'
import { placeCenter, placeOf, shownLocation, trailPlaces, type Place } from '../src/lib/places.ts'
import { currentStay, type LatLon } from '../src/lib/segments.ts'
import { trailProfile } from '../src/lib/tracker.ts'
import {
  extendTrails,
  historyMinutes,
  historyStart,
  stayPoints,
  trailStart,
  type TrailLength,
  type TrailPoint,
  type Trails,
} from '../src/lib/trail.ts'
import { drawTrail, firstShown, trailFrom, trailView, type DrawnTrail, type TrailView } from '../src/lib/trailGeometry.ts'
import { matchWalk } from '../src/server/matching.server.ts'
import { toPositionUpdate, toTrailPoint } from '../src/server/positions.server.ts'
import { parsePosition, type TraccarPosition } from '../src/server/traccar.server.ts'

// The server's config wants these; nothing here talks to Traccar or signs anything.
process.env.TRACCAR_URL ??= 'http://127.0.0.1:9'
process.env.SESSION_SECRET ??= 'replay-only-not-a-secret-'.repeat(2)

/** The app's clock (useNow in useLiveAssets). */
const TICK_MS = 15_000
/** useSnappedWalks waits this long after the trail changes before asking. */
const DEBOUNCE_MS = 1_000
/** A part of the trail this long before the newest fix is settled: it shouldn't change any more. */
const SETTLED_MS = 15 * 60 * 1000
/** Drawn points this close are the same point: anything less doesn't show. */
const SAME_METRES = 3
/** The marker moving this far at once is a jump; back within RETURN_METRES of where it was in RETURN_MS, out and back. */
const JUMP_METRES = 30
const RETURN_METRES = 15
const RETURN_MS = 3 * 60 * 1000
/** "Here since" back to a time it showed this recently is a flicker. */
const FLICKER_MS = 10 * 60 * 1000
/** Walking, for the card: a fix this fresh, and one at least WALKING_METRES from it within WALKING_WITHIN_MS. */
const WALKING_FRESH_MS = 2 * 60 * 1000
const WALKING_METRES = 60
const WALKING_WITHIN_MS = 5 * 60 * 1000
/** Drawn this far from every fix, it's made up. */
const FAR_METRES = 40

type Label = { kind: 'error' | 'likely-error' | 'real'; from: number; to: number; what: string }
type Fixture = { positions: (TraccarPosition & { serverTime: number })[]; places: Place[]; labels: Label[]; deviceId: number }

type Score = {
  reports: number
  frames: number
  /** Snap to paths: walks asked for, and walks drawn as recorded for a moment while their new version is asked for. */
  snapRequests: number
  flashes: number
  /** The trail changing more than SETTLED_MS before the newest fix, when a report comes. */
  pastChanges: { frames: number; metres: number }
  /** The trail changing with no report (the clock alone), but for its old end leaving the window; and the latest outing changing. */
  idleChanges: { frames: number; metres: number; dots: number; outing: number }
  marker: { jumps: number; outAndBack: number; placeToggles: number }
  card: { changes: number; backwards: number; flickers: number; walkingMinutes: number; walkingShownMinutes: number }
  greyMinutes: number
  /** Hourly pictures of the trail: how much walking is drawn, and how much of it far from every fix. */
  picture: { drawnMetres: number; farMetres: number }
  /** For each label: its fixes' length, and how long, how much of it and how long the marker was on it, it was drawn. */
  labels: { kind: Label['kind']; what: string; fixMetres: number; drawnMinutes: number; maxDrawnMetres: number; markerMinutes: number }[]
}

type XY = [number, number]
type Segment = { a: XY; b: XY; t1: number; t2: number }

/** One moment of the map: what it showed until the next. */
type Frame = {
  time: number
  tick: boolean
  /** Where the trail starts, the newest fix, and when the latest outing began. */
  from: number
  newest: number
  outing: number | null
  /** The trail as worked out, drawn without Snap to paths. */
  recorded: Segments
  dots: { at: XY; to: number }[]
  /** Each walk drawn (see identity) and whether along its snapped line; those not asked for yet. */
  walks: Map<string, boolean>
  pending: Set<string>
}

/** The segments of a trail as drawn, found by where they start (in a grid), to tell what changed. */
class Segments {
  readonly list: Segment[] = []
  private readonly grid = new Map<string, Segment[]>()

  constructor(drawn: DrawnTrail | null) {
    for (const line of [...(drawn?.walks ?? []), ...(drawn?.rides ?? [])]) {
      for (let i = 1; i < line.points.length; i++) {
        const [p, q] = [line.points[i - 1]!, line.points[i]!]
        const segment = { a: xy(p), b: xy(q), t1: p.time, t2: q.time }
        this.list.push(segment)
        const cell = Segments.cell(segment.a)
        this.grid.set(cell, [...(this.grid.get(cell) ?? []), segment])
      }
    }
  }

  /** Whether a segment is drawn here too, within SAME_METRES at each end. */
  has(segment: Segment): boolean {
    const [x, y] = [Math.floor(segment.a[0] / SAME_METRES), Math.floor(segment.a[1] / SAME_METRES)]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of this.grid.get(`${x + dx},${y + dy}`) ?? []) {
          if (metres(other.a, segment.a) <= SAME_METRES && metres(other.b, segment.b) <= SAME_METRES) return true
        }
      }
    }
    return false
  }

  private static cell(at: XY): string {
    return `${Math.floor(at[0] / SAME_METRES)},${Math.floor(at[1] / SAME_METRES)}`
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    trail: { type: 'string', default: '60,360,1440' },
    from: { type: 'string' },
    to: { type: 'string' },
    baseline: { type: 'string' },
    json: { type: 'string' },
    events: { type: 'boolean', default: false },
  },
})
if (positionals.length !== 1) {
  console.error(
    'usage: npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>] [--baseline <file>] [--json <file>] [--events]',
  )
  process.exit(2)
}

const fixture = loadFixture(positionals[0]!)
const origin = { lat: fixture.positions[0]!.latitude, lon: fixture.positions[0]!.longitude }
const snapping = !!process.env.MAP_MATCHING_URL
const first = fixture.positions[0]!.serverTime
const last = fixture.positions.at(-1)!.serverTime
// Opened late enough by default that every trail length starts with all of its history.
const opened = values.from ? Date.parse(values.from) : first + historyMinutes('today') * 60_000
const closed = values.to ? Date.parse(values.to) : last
const lengths = values.trail.split(',').map((value): TrailLength => (value === 'today' ? 'today' : Number(value)))
const local = (time: number) =>
  new Date(time).toLocaleString('sv-SE', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const log = (time: number, what: string) => values.events && console.log(`  ${local(time)} ${what}`)

console.log(
  `${fixture.positions.length} reports, ${local(first)} to ${local(last)}; open ${local(opened)} to ${local(closed)};`,
  `Snap to paths ${snapping ? 'on' : 'off (no MAP_MATCHING_URL)'}; no parks (they come from the map's tiles)`,
)
const scores: Record<string, Score> = {}
for (const length of lengths) {
  console.log(`\nTrail ${length}:`)
  const started = performance.now()
  const score = await replay(length)
  scores[String(length)] = score
  printScore(score, performance.now() - started)
}
if (values.json) fs.writeFileSync(values.json, JSON.stringify(scores, null, 1))
if (values.baseline) process.exitCode = compare(JSON.parse(fs.readFileSync(values.baseline, 'utf8')) as Record<string, Score>, scores)

/** The map open from `opened` to `closed` with this trail length. */
async function replay(length: TrailLength): Promise<Score> {
  const { deviceId: id, places, labels } = fixture
  const historyLength = historyMinutes(length)
  const s: Score = {
    reports: 0,
    frames: 0,
    snapRequests: 0,
    flashes: 0,
    pastChanges: { frames: 0, metres: 0 },
    idleChanges: { frames: 0, metres: 0, dots: 0, outing: 0 },
    marker: { jumps: 0, outAndBack: 0, placeToggles: 0 },
    card: { changes: 0, backwards: 0, flickers: 0, walkingMinutes: 0, walkingShownMinutes: 0 },
    greyMinutes: 0,
    picture: { drawnMetres: 0, farMetres: 0 },
    labels: labels.map((label) => {
      const fixes = fixture.positions
        .filter((p) => p.valid && Date.parse(p.fixTime) >= label.from && Date.parse(p.fixTime) <= label.to)
        .map(xy)
      const fixMetres = Math.round(fixes.slice(1).reduce((sum, p, i) => sum + metres(fixes[i]!, p), 0))
      return { kind: label.kind, what: label.what, fixMetres, drawnMinutes: 0, maxDrawnMetres: 0, markerMinutes: 0 }
    }),
  }

  // The page loads (useLiveAssets, loadTrails): the history up to now, then the live stream.
  const known = fixture.positions.filter((position) => position.serverTime <= opened)
  const latest = known.reduce<(typeof known)[number] | undefined>(
    (a, b) => (!a || Date.parse(b.fixTime) >= Date.parse(a.fixTime) ? b : a),
    undefined,
  )
  const start = historyStart(new Date(opened - historyLength * 60_000), new Date(opened), latest && Date.parse(latest.fixTime)).getTime()
  let trails: Trails = {
    [id]: known
      .filter((position) => Date.parse(position.fixTime) >= start && Date.parse(position.fixTime) <= opened)
      .map(toTrailPoint)
      .sort((a, b) => a.time - b.time),
  }
  const empty: Asset = { id, name: 'replay', status: 'online', lastUpdate: null, location: null, placeIds: [] }
  let assets = latest ? applyUpdates([empty], [toPositionUpdate(latest)]).assets : [empty]
  const arrivals = fixture.positions.filter((position) => position.serverTime > opened && position.serverTime <= closed)
  s.reports = arrivals.length

  // The browser's Snap to paths (useSnappedWalks): answers by walk key, and what it has asked for.
  let results: Record<string, LatLon[] | null> = {}
  const asked = new Set<string>()
  const askedKey = (walk: { key: string; points: MatchablePoint[] }) =>
    `${walk.key}:${walk.points.map((point) => (point.park ? 'p' : '-')).join('')}`

  let worked: { points: TrailPoint[] | undefined; view: TrailView | null } = { points: undefined, view: null }
  let previous: Frame | null = null
  // What the last frame showed, scored once it's known how long it showed (until the next frame).
  let account: ((minutes: number) => void) | null = null
  const markerSeen: { time: number; at: XY; atPlace: boolean }[] = []
  const sinceSeen: { time: number; since: number | null }[] = []
  let nextPicture = Math.ceil(opened / 3_600_000) * 3_600_000

  let now = opened
  let nextTick = opened + TICK_MS
  for (let k = 0; ;) {
    // The next report, or the clock's next tick before it.
    const arrival = arrivals[k]
    const tick = !arrival || nextTick <= arrival.serverTime
    const time = tick ? nextTick : arrival.serverTime
    if (time > closed) break
    if (tick) {
      now = nextTick
      nextTick += TICK_MS
    } else {
      const updates = [toPositionUpdate(arrival)]
      assets = applyUpdates(assets, updates).assets
      trails = extendTrails(trails, updates, time - historyLength * 60_000)
      k++
    }
    const asset = assets[0]!
    const profile = trailProfile(asset.tracker)

    // What the map shows (useLiveAssets → setTrails, useSnappedWalks, the marker, the details card): the
    // trail worked out from all of the asset's points as they come, drawn from where it starts.
    if (worked.points !== trails[id])
      worked = { points: trails[id], view: trails[id] ? trailView(trails[id], places, id, asset.tracker) : null }
    const from = trailStart(length, now)
    const view = worked.view && from !== null ? trailFrom(worked.view, firstShown(worked.view.pieces, from)) : null
    const walks = snapping && view ? matchableWalks(view.pieces, () => false, profile) : []
    const snapped: Record<string, LatLon[]> = {}
    for (const walk of walks) if (results[walk.key]) snapped[walk.key] = results[walk.key]!
    const shown = view ? drawTrail(view, snapped) : null
    const recorded = view ? drawTrail(view, {}) : null
    const location = asset.location
    const marker = location ? shownLocation(places, id, location, trails[id], profile) : null
    const since = currentStay(stayPoints(trails[id] ?? [], length), now, profile, trailPlaces(places, id))?.since ?? null

    const frame: Frame = {
      time,
      tick,
      from: from ?? Infinity,
      newest: view?.newest ?? 0,
      outing: view?.outing ?? null,
      recorded: new Segments(recorded),
      dots: (recorded?.dots ?? []).map((dot) => ({ at: xy(dot.center), to: dot.to })),
      walks: new Map((shown?.walks ?? []).map((walk) => [identity(walk.key), walk.snapped])),
      pending: new Set(walks.filter((walk) => !(walk.key in results)).map((walk) => identity(walk.key))),
    }
    s.frames++
    account?.((time - previous!.time) / 60_000)

    if (previous) {
      // Snap to paths: a walk drawn along its line, now as recorded while its new version is asked for.
      for (const [walk, wasSnapped] of previous.walks) {
        if (wasSnapped && frame.walks.get(walk) === false && frame.pending.has(walk)) {
          s.flashes++
          log(time, `flash: the walk from ${walk.startsWith('stays-') ? 'a stay' : local(Number(walk))} drawn as recorded`)
        }
      }
      // The trail changing: its settled parts when a report comes; anything but its old end leaving when none does.
      const gone = previous.recorded.list.filter((segment) => segment.t2 >= frame.from && !frame.recorded.has(segment))
      if (tick) {
        const added = frame.recorded.list.filter((segment) => !previous!.recorded.has(segment))
        const near = (dot: { at: XY }, dots: { at: XY }[]) => dots.some((other) => metres(dot.at, other.at) <= SAME_METRES)
        const dots =
          previous.dots.filter((dot) => dot.to >= frame.from && !near(dot, frame.dots)).length +
          frame.dots.filter((dot) => !near(dot, previous!.dots)).length
        if (gone.length || added.length || dots) {
          s.idleChanges.frames++
          s.idleChanges.metres += lengthOf(gone) + lengthOf(added)
          s.idleChanges.dots += dots
          log(time, `idle change: ${Math.round(lengthOf(gone) + lengthOf(added))} m of trail, ${dots} dots`)
        }
        if (frame.outing !== previous.outing && frame.recorded.list.length && previous.recorded.list.length) s.idleChanges.outing++
      } else {
        const past = gone.filter((segment) => segment.t2 < previous!.newest - SETTLED_MS)
        if (past.length) {
          s.pastChanges.frames++
          s.pastChanges.metres += lengthOf(past)
          log(time, `past change: ${Math.round(lengthOf(past))} m of trail from ${local(past[0]!.t1)}`)
        }
      }
    }

    // The marker: jumps, out and back, in and out of its places (at a place, it's at the place's centre).
    if (marker) {
      const at = xy(marker)
      const atPlace = places.some((place) => {
        const center = placeCenter(place.area)
        return place.assetIds.includes(id) && center.lat === marker.lat && center.lon === marker.lon
      })
      const before = markerSeen.at(-1)
      if (before && metres(before.at, at) > JUMP_METRES) {
        s.marker.jumps++
        if (markerSeen.some((seen) => seen !== before && time - seen.time <= RETURN_MS && metres(seen.at, at) <= RETURN_METRES))
          s.marker.outAndBack++
        log(time, `marker jump: ${Math.round(metres(before.at, at))} m`)
      }
      if (before && before.atPlace !== atPlace) s.marker.placeToggles++
      markerSeen.push({ time, at, atPlace })
      while (markerSeen.length > 1 && time - markerSeen[0]!.time > RETURN_MS) markerSeen.shift()
    }

    // "Here since": changes, going back in time, and back to what it said moments ago.
    const said = sinceSeen.at(-1)
    if (!said || said.since !== since) {
      if (said) {
        s.card.changes++
        if (said.since !== null && since !== null && since < said.since - 60_000) s.card.backwards++
        if (sinceSeen.some((seen) => seen !== said && time - seen.time <= FLICKER_MS && seen.since === since)) s.card.flickers++
      }
      sinceSeen.push({ time, since })
      while (sinceSeen.length > 1 && time - sinceSeen[0]!.time > FLICKER_MS) sinceSeen.shift()
    }

    // An hourly picture of the trail as it is: how much walking, how much of it far from every fix.
    if (time >= nextPicture && shown) {
      nextPicture += 3_600_000
      const fixes = (trails[id] ?? []).filter((point) => point.valid && point.time >= view!.oldest).map(xy)
      for (const walk of shown.walks) {
        for (let i = 1; i < walk.points.length; i++) {
          const [a, b] = [xy(walk.points[i - 1]!), xy(walk.points[i]!)]
          const d = metres(a, b)
          const steps = Math.max(1, Math.ceil(d / 5))
          s.picture.drawnMetres += d
          for (let j = 0; j < steps; j++) {
            const p: XY = [a[0] + ((b[0] - a[0]) * (j + 0.5)) / steps, a[1] + ((b[1] - a[1]) * (j + 0.5)) / steps]
            if (!fixes.some((fix) => metres(fix, p) <= FAR_METRES)) s.picture.farMetres += d / steps
          }
        }
      }
    }

    // Scored when the next frame comes: grey, the card while walking, the labelled reports drawn.
    // A snapped line's points have times spread evenly along the walk (see alongPaths), so a label's
    // part of one is found roughly.
    const drawnSegments = new Segments(shown).list
    const markerFix =
      marker === location
        ? (trails[id] ?? []).findLast((point) => point.valid && point.lat === marker?.lat && point.lon === marker?.lon)
        : undefined
    const walking = isWalking(trails[id] ?? [], time)
    const grey = isStale(asset, now)
    account = (minutes) => {
      if (grey) s.greyMinutes += minutes
      if (walking) s.card.walkingMinutes += minutes
      if (walking && since !== null) s.card.walkingShownMinutes += minutes
      labels.forEach((label, index) => {
        const inLabel = drawnSegments.filter(
          (segment) => (segment.t1 + segment.t2) / 2 >= label.from && (segment.t1 + segment.t2) / 2 <= label.to,
        )
        const drawn = lengthOf(inLabel)
        const out = s.labels[index]!
        if (drawn > 0) out.drawnMinutes += minutes
        out.maxDrawnMetres = Math.max(out.maxDrawnMetres, Math.round(drawn))
        if (markerFix && markerFix.time >= label.from && markerFix.time <= label.to) out.markerMinutes += minutes
      })
    }
    previous = frame

    // Snap to paths asks for the walks it hasn't, once the trail has been still for DEBOUNCE_MS; the
    // answers are in by the next frame.
    const next = Math.min(nextTick, arrivals[k]?.serverTime ?? Infinity)
    const missing = walks.filter((walk) => !asked.has(askedKey(walk))).slice(0, MAX_WALKS_PER_REQUEST)
    if (missing.length && next - time >= DEBOUNCE_MS) {
      for (const walk of missing) asked.add(askedKey(walk))
      const lines = await Promise.all(missing.map((walk) => matchWalk(walk.points)))
      s.snapRequests += missing.length
      // Only walks still on the trail are kept; a growing walk replaces its earlier versions.
      const keys = new Set(walks.map((walk) => walk.key))
      const kept: typeof results = {}
      for (const [key, line] of Object.entries(results)) if (keys.has(key)) kept[key] = line
      missing.forEach((walk, index) => (kept[walk.key] = lines[index] ?? null))
      results = kept
      const current = new Set(walks.map(askedKey))
      for (const key of asked) if (!current.has(key)) asked.delete(key)
    }
  }
  if (previous) account?.((closed - previous.time) / 60_000)

  s.pastChanges.metres = Math.round(s.pastChanges.metres)
  s.idleChanges.metres = Math.round(s.idleChanges.metres)
  s.card.walkingMinutes = Math.round(s.card.walkingMinutes)
  s.card.walkingShownMinutes = Math.round(s.card.walkingShownMinutes)
  s.greyMinutes = Math.round(s.greyMinutes)
  s.picture = { drawnMetres: Math.round(s.picture.drawnMetres), farMetres: Math.round(s.picture.farMetres) }
  for (const label of s.labels) {
    label.drawnMinutes = Math.round(label.drawnMinutes * 10) / 10
    label.markerMinutes = Math.round(label.markerMinutes * 10) / 10
  }
  return s
}

/** A walk by its first fix, so it's the same walk as it grows (see walkKey); a hop between dots by its own key. */
function identity(key: string): string {
  return key.startsWith('stays-') ? key : key.split('-')[0]!
}

function lengthOf(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + metres(segment.a, segment.b), 0)
}

/** Walking right now, by the fixes: a fresh one, and another at least WALKING_METRES from it within WALKING_WITHIN_MS. */
function isWalking(points: TrailPoint[], now: number): boolean {
  const fixes = points.filter((point) => point.valid && point.time > now - WALKING_WITHIN_MS && point.time <= now)
  const newest = fixes.at(-1)
  return !!newest && now - newest.time <= WALKING_FRESH_MS && fixes.some((fix) => metres(xy(fix), xy(newest)) >= WALKING_METRES)
}

/** Metres east and north of the fixture's first position. */
function xy(point: LatLon | { latitude: number; longitude: number }): XY {
  const [lat, lon] = 'lat' in point ? [point.lat, point.lon] : [point.latitude, point.longitude]
  return [(lon - origin.lon) * Math.cos((origin.lat * Math.PI) / 180) * 111_320, (lat - origin.lat) * 110_540]
}

function metres(a: XY, b: XY): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function loadFixture(folder: string): Fixture {
  const byId = new Map<unknown, TraccarPosition & { serverTime: number }>()
  let geofences: { id: number; name: string; area: string; attributes?: Record<string, unknown> }[] = []
  let labels: Label[] = []
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.json'))) {
    const content: unknown = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'))
    if (file === 'geofences.json') geofences = content as typeof geofences
    else if (file === 'labels.json') {
      labels = (content as (Omit<Label, 'from' | 'to'> & { from: string; to: string })[]).map((label) => ({
        ...label,
        from: Date.parse(label.from),
        to: Date.parse(label.to),
      }))
    } else if (Array.isArray(content)) {
      for (const raw of content as { id: unknown; serverTime: string }[])
        byId.set(raw.id, { ...parsePosition(raw), serverTime: Date.parse(raw.serverTime) })
    }
  }
  const positions = [...byId.values()].sort((a, b) => a.serverTime - b.serverTime || Date.parse(a.fixTime) - Date.parse(b.fixTime))
  if (positions.length === 0) throw new Error(`No positions in ${folder}`)
  // The asset is the device with the most positions; the places are its.
  const counts = new Map<number, number>()
  for (const position of positions) counts.set(position.deviceId, (counts.get(position.deviceId) ?? 0) + 1)
  const deviceId = [...counts].sort((a, b) => b[1] - a[1])[0]![0]
  const places = geofences.flatMap((geofence) => placeOf({ ...geofence, attributes: geofence.attributes ?? {} }, [deviceId]) ?? [])
  return { positions: positions.filter((position) => position.deviceId === deviceId), places, labels, deviceId }
}

function printScore(s: Score, ms: number) {
  const rows: [string, string][] = [
    ['reports, frames', `${s.reports}, ${s.frames} (${Math.round(ms / 1000)} s)`],
    ['snap requests, flashes', `${s.snapRequests}, ${s.flashes}`],
    ['past changes (frames, m)', `${s.pastChanges.frames}, ${s.pastChanges.metres}`],
    [
      'idle changes (frames, m, dots, outing)',
      `${s.idleChanges.frames}, ${s.idleChanges.metres}, ${s.idleChanges.dots}, ${s.idleChanges.outing}`,
    ],
    ['marker jumps, out and back, place toggles', `${s.marker.jumps}, ${s.marker.outAndBack}, ${s.marker.placeToggles}`],
    ['here since: changes, backwards, flickers', `${s.card.changes}, ${s.card.backwards}, ${s.card.flickers}`],
    ['here since while walking (min)', `${s.card.walkingShownMinutes} of ${s.card.walkingMinutes}`],
    ['grey (min)', `${s.greyMinutes}`],
    ['hourly pictures: walking drawn, far from fixes (m)', `${s.picture.drawnMetres}, ${s.picture.farMetres}`],
  ]
  for (const label of s.labels) {
    rows.push([
      `${label.kind}: ${label.what}`,
      `${label.fixMetres} m of fixes; drawn for ${label.drawnMinutes} min, at most ${label.maxDrawnMetres} m; the marker on it ${label.markerMinutes} min`,
    ])
  }
  const width = Math.max(...rows.map(([name]) => name.length))
  for (const [name, value] of rows) console.log(`  ${name.padEnd(width)}  ${value}`)
}

/** Where these scores are worse than the baseline's, listed; as an exit code, 1 when anywhere. */
function compare(baseline: Record<string, Score>, now: Record<string, Score>): number {
  const worse: string[] = []
  const check = (name: string, before: number | undefined, after: number, higherIsBetter = false) => {
    if (before !== undefined && (higherIsBetter ? after < before : after > before)) worse.push(`${name}: ${before} → ${after}`)
  }
  for (const [length, s] of Object.entries(now)) {
    const b = baseline[length]
    if (!b) continue
    check(`${length}: flashes`, b.flashes, s.flashes)
    check(`${length}: past changes (m)`, b.pastChanges.metres, s.pastChanges.metres)
    check(`${length}: idle changes`, b.idleChanges.frames, s.idleChanges.frames)
    check(`${length}: marker jumps`, b.marker.jumps, s.marker.jumps)
    check(`${length}: marker place toggles`, b.marker.placeToggles, s.marker.placeToggles)
    check(`${length}: here since backwards`, b.card.backwards, s.card.backwards)
    check(`${length}: here since flickers`, b.card.flickers, s.card.flickers)
    check(`${length}: here since while walking (min)`, b.card.walkingShownMinutes, s.card.walkingShownMinutes)
    check(`${length}: grey (min)`, b.greyMinutes, s.greyMinutes)
    check(`${length}: drawn far from fixes (m)`, b.picture.farMetres, s.picture.farMetres)
    for (const label of s.labels) {
      const before = b.labels.find((other) => other.what === label.what)
      if (!before) continue
      const real = label.kind === 'real'
      check(`${length}: ${label.what}, drawn (min)`, before.drawnMinutes, label.drawnMinutes, real)
      if (!real) check(`${length}: ${label.what}, the marker on it (min)`, before.markerMinutes, label.markerMinutes)
    }
  }
  console.log(worse.length ? `\nWorse than the baseline:\n  ${worse.join('\n  ')}` : '\nNo worse than the baseline anywhere.')
  return worse.length ? 1 : 0
}
