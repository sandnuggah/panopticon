// The trail replay: plays a tracker's real reports through the map's own code, in the order they
// arrived and with the app's 15-second clock, as if the map had been open all along (or opened again
// every so often, --reload), and scores how the trail behaves while you watch it. Every change to how
// the trail is worked out or drawn should keep the score or make it better (see ARCHITECTURE.md →
// Trail → The replay). Dev only.
//
//   npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>]
//     [--reload <minutes>] [--baseline <score.json>] [--json <score.json>] [--events]
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
import { drawTrail, shownTrails, trailViews, type DrawnTrail, type TrailView, type TrailViewCache } from '../src/lib/trailGeometry.ts'
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
/** A change of opacity this big shows. */
const SAME_OPACITY = 0.05
/** The marker moving this far at once is a jump; back within RETURN_METRES of where it was in RETURN_MS, out and back. */
const JUMP_METRES = 30
const RETURN_METRES = 15
const RETURN_MS = 3 * 60 * 1000
/** "Here since" back to what it said this recently is a flicker. */
const FLICKER_MS = 10 * 60 * 1000
/** Walking, for the card: a fix this fresh, and one at least WALKING_METRES from it within WALKING_WITHIN_MS. */
const WALKING_FRESH_MS = 2 * 60 * 1000
const WALKING_METRES = 60
const WALKING_WITHIN_MS = 5 * 60 * 1000
/** Drawn this far from every fix, it's made up. */
const FAR_METRES = 40
/**
 * A labelled fix this close to the trail drawn for its time (give or take LABEL_SLACK_MS: the times of
 * a snapped line's points are spread evenly along the walk) is drawn; a real outing with this share of
 * its fixes drawn is.
 */
const DRAWN_METRES = 10
const LABEL_SLACK_MS = 5 * 60 * 1000
const REAL_DRAWN_SHARE = 0.8

type Label = { kind: 'error' | 'likely-error' | 'real'; from: number; to: number; what: string }
type Fixture = { positions: (TraccarPosition & { serverTime: number })[]; places: Place[]; labels: Label[]; deviceId: number }

/** What was replayed: scores only compare when this is the same. */
type Run = { reports: number; opened: string; closed: string; snapping: boolean; reload: number | null }

type Score = {
  frames: number
  /** Snap to paths: walks asked for; a walk drawn along its line, then as recorded while its new version is asked for; or for good. */
  snapRequests: number
  flashes: number
  linesLost: number
  /** The trail changing more than SETTLED_MS before the newest fix when a report comes: lines and dots. */
  pastChanges: { frames: number; metres: number; dots: number }
  /** The trail changing with no report (the clock alone), but for its old end dropping off; and its fading. */
  idleChanges: { frames: number; metres: number; dots: number; fade: number }
  /** The trail changing when the page is opened again (--reload), but for its old end dropping off. */
  reloadChanges: { frames: number; metres: number; dots: number }
  marker: { jumps: number; outAndBack: number; placeToggles: number }
  card: { changes: number; backwards: number; flickers: number; walkingMinutes: number; walkingShownMinutes: number }
  greyMinutes: number
  /** Hourly pictures of the trail: how much walking is drawn, and how much of it far from every fix. */
  picture: { drawnMetres: number; farMetres: number }
  /**
   * For each label: its fixes' length; minutes its time was in the trail drawn, and that it was drawn
   * (an error: any of its fixes; a real outing: REAL_DRAWN_SHARE of them); and minutes the marker was on it.
   */
  labels: { kind: Label['kind']; what: string; fixMetres: number; inTrailMinutes: number; drawnMinutes: number; markerMinutes: number }[]
}

type XY = [number, number]
type Segment = { a: XY; b: XY; t1: number; t2: number; opacity: number }
/** A walk as drawn, with its time span: along its snapped line, and whether its version was asked for yet. */
type Walk = { key: string; t1: number; t2: number; snapped: boolean; pending: boolean }

/** One moment of the map: what it showed until the next. */
type Frame = {
  time: number
  kind: 'tick' | 'report' | 'reload'
  /** Where the trail starts, and its newest fix. */
  from: number
  newest: number
  /** The trail as worked out, drawn without Snap to paths, and its dots. */
  recorded: Segments
  dots: { at: XY; to: number }[]
  walks: Walk[]
}

/** The segments of a trail as drawn, in a grid of SAME_METRES by where they start, to tell what changed. */
class Segments {
  readonly list: Segment[] = []
  private readonly grid = new Map<string, Segment[]>()

  constructor(drawn: DrawnTrail | null) {
    for (const line of [...(drawn?.walks ?? []), ...(drawn?.rides ?? [])]) {
      for (let i = 1; i < line.points.length; i++) {
        const [p, q] = [line.points[i - 1]!, line.points[i]!]
        const segment = { a: xy(p), b: xy(q), t1: p.time, t2: q.time, opacity: drawn!.opacity(q.time) }
        this.list.push(segment)
        const cell = Segments.cell(segment.a)
        this.grid.set(cell, [...(this.grid.get(cell) ?? []), segment])
      }
    }
  }

  /**
   * The same segment drawn here, within SAME_METRES at each end; `ofItsTime`, the one drawn for the
   * same time (another walk along the same street is drawn there too, older or newer).
   */
  find(segment: Segment, ofItsTime = false): Segment | undefined {
    const [x, y] = [Math.floor(segment.a[0] / SAME_METRES), Math.floor(segment.a[1] / SAME_METRES)]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of this.grid.get(`${x + dx},${y + dy}`) ?? []) {
          if (ofItsTime && (other.t1 !== segment.t1 || other.t2 !== segment.t2)) continue
          if (metres(other.a, segment.a) <= SAME_METRES && metres(other.b, segment.b) <= SAME_METRES) return other
        }
      }
    }
    return undefined
  }

  private static cell(at: XY): string {
    return `${Math.floor(at[0] / SAME_METRES)},${Math.floor(at[1] / SAME_METRES)}`
  }
}

const USAGE =
  'usage: npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>] [--reload <minutes>] [--baseline <file>] [--json <file>] [--events]'
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    trail: { type: 'string', default: '60,360,1440' },
    from: { type: 'string' },
    to: { type: 'string' },
    reload: { type: 'string' },
    baseline: { type: 'string' },
    json: { type: 'string' },
    events: { type: 'boolean', default: false },
  },
})
const lengths = values.trail.split(',').map((value): TrailLength => (value === 'today' ? 'today' : Number(value)))
const reload = values.reload === undefined ? null : Number(values.reload)
const bad = (value: number | undefined) => value !== undefined && !(Number.isFinite(value) && value > 0)
if (
  positionals.length !== 1 ||
  lengths.some((length) => length !== 'today' && bad(length)) ||
  bad(reload ?? undefined) ||
  (values.from !== undefined && Number.isNaN(Date.parse(values.from))) ||
  (values.to !== undefined && Number.isNaN(Date.parse(values.to)))
) {
  console.error(USAGE)
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
const local = (time: number) =>
  new Date(time).toLocaleString('sv-SE', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const log = (time: number, what: string) => values.events && console.log(`  ${local(time)} ${what}`)
const run: Run = {
  reports: fixture.positions.filter((position) => position.serverTime > opened && position.serverTime <= closed).length,
  opened: new Date(opened).toISOString(),
  closed: new Date(closed).toISOString(),
  snapping,
  reload,
}

console.log(
  `${fixture.positions.length} reports, ${local(first)} to ${local(last)}; open ${local(opened)} to ${local(closed)}` +
    `${reload ? `, opened again every ${reload} min` : ''}; Snap to paths ${snapping ? 'on' : 'off (no MAP_MATCHING_URL)'};` +
    ` no parks (they come from the map's tiles)`,
)
const scores: Record<string, Score> = {}
for (const length of lengths) {
  console.log(`\nTrail ${length}:`)
  const started = performance.now()
  const score = await replay(length)
  scores[String(length)] = score
  printScore(score, performance.now() - started)
}
if (values.json) fs.writeFileSync(values.json, JSON.stringify({ run, scores }, null, 1))
if (values.baseline) {
  process.exitCode = compare(JSON.parse(fs.readFileSync(values.baseline, 'utf8')) as { run: Run; scores: Record<string, Score> })
}

/** The map open from `opened` to `closed` with this trail length. */
async function replay(length: TrailLength): Promise<Score> {
  const { deviceId: id, places, labels } = fixture
  const historyLength = historyMinutes(length)
  const labelFixes = labels.map((label) =>
    fixture.positions.filter((p) => p.valid && Date.parse(p.fixTime) >= label.from && Date.parse(p.fixTime) <= label.to).map(xy),
  )
  const s: Score = {
    frames: 0,
    snapRequests: 0,
    flashes: 0,
    linesLost: 0,
    pastChanges: { frames: 0, metres: 0, dots: 0 },
    idleChanges: { frames: 0, metres: 0, dots: 0, fade: 0 },
    reloadChanges: { frames: 0, metres: 0, dots: 0 },
    marker: { jumps: 0, outAndBack: 0, placeToggles: 0 },
    card: { changes: 0, backwards: 0, flickers: 0, walkingMinutes: 0, walkingShownMinutes: 0 },
    greyMinutes: 0,
    picture: { drawnMetres: 0, farMetres: 0 },
    labels: labels.map((label, index) => {
      const fixes = labelFixes[index]!
      const fixMetres = Math.round(fixes.slice(1).reduce((sum, p, i) => sum + metres(fixes[i]!, p), 0))
      return { kind: label.kind, what: label.what, fixMetres, inTrailMinutes: 0, drawnMinutes: 0, markerMinutes: 0 }
    }),
  }

  // The page loads (useLiveAssets → loadTrails): its history as of `time`, and its latest position.
  const load = (time: number) => {
    const known = fixture.positions.filter((position) => position.serverTime <= time)
    const latest = known.reduce<(typeof known)[number] | undefined>(
      (a, b) => (!a || Date.parse(b.fixTime) >= Date.parse(a.fixTime) ? b : a),
      undefined,
    )
    const start = historyStart(historyLength, time, latest && Date.parse(latest.fixTime))
    const points = known
      .filter((position) => Date.parse(position.fixTime) >= start && Date.parse(position.fixTime) <= time)
      .map(toTrailPoint)
      .sort((a, b) => a.time - b.time)
    return { trails: { [id]: points } as Trails, latest }
  }
  const loaded = load(opened)
  let trails = loaded.trails
  const empty: Asset = { id, name: 'replay', status: 'online', lastUpdate: null, location: null, placeIds: [] }
  let assets = loaded.latest ? applyUpdates([empty], [toPositionUpdate(loaded.latest)]).assets : [empty]
  const arrivals = fixture.positions.filter((position) => position.serverTime > opened && position.serverTime <= closed)

  // The browser's Snap to paths (useSnappedWalks): answers by walk key, and what it has asked for.
  let results: Record<string, LatLon[] | null> = {}
  const asked = new Set<string>()
  const askedKey = (walk: { key: string; points: MatchablePoint[] }) =>
    `${walk.key}:${walk.points.map((point) => (point.park ? 'p' : '-')).join('')}`
  // Walks that were drawn along their line, by their time span; and walks drawn as recorded, by key,
  // that were one of those (lost) or weren't (checked once each).
  const hadLines = new Map<string, { t1: number; t2: number }>()
  const lost = new Set<string>()
  const neverHad = new Set<string>()

  const cache: TrailViewCache = new Map()
  let previous: Frame | null = null
  // What the last frame showed, scored once it's known how long it showed (until the next frame).
  let account: ((minutes: number) => void) | null = null
  const markerSeen: { time: number; at: XY; atPlace: boolean }[] = []
  // "Here since" as it is, and when each time it showed was last shown.
  let said: number | null | undefined
  const lastSaid = new Map<number | null, number>()
  let nextPicture = Math.ceil(opened / 3_600_000) * 3_600_000
  // The labelled fixes drawn, as of the drawing they were worked out on.
  let drawnLabels: { drawing: DrawnTrail | null; shares: number[] } = { drawing: null, shares: labels.map(() => 0) }

  let now = opened
  let nextTick = opened + TICK_MS
  let nextReload = reload ? opened + reload * 60_000 : Infinity
  for (let k = 0; ;) {
    // The next report, or the page opened again, or the clock's next tick, whichever comes first.
    const arrival = arrivals[k]
    const time = Math.min(nextTick, nextReload, arrival?.serverTime ?? Infinity)
    if (time > closed) break
    let kind: Frame['kind']
    if (time === nextReload) {
      kind = 'reload'
      nextReload += reload! * 60_000
      trails = load(time).trails
    } else if (time === nextTick) {
      kind = 'tick'
      now = nextTick
      nextTick += TICK_MS
    } else {
      kind = 'report'
      const updates = [toPositionUpdate(arrival!)]
      assets = applyUpdates(assets, updates).assets
      trails = extendTrails(trails, updates, historyLength, time)
      k++
    }
    const asset = assets[0]!
    const profile = trailProfile(asset.tracker)

    // What the map shows (useLiveAssets → setTrails, useSnappedWalks, the marker, the details card).
    const from = trailStart(length, now)
    const view: TrailView | null = shownTrails(trailViews(trails, places, { [id]: asset.tracker }, cache), from)[id] ?? null
    const walks = snapping && view ? matchableWalks(view.pieces, () => false, profile) : []
    const snapped: Record<string, LatLon[]> = {}
    for (const walk of walks) if (results[walk.key]) snapped[walk.key] = results[walk.key]!
    const shown = view ? drawTrail(view, snapped) : null
    const recorded = view ? drawTrail(view, {}) : null
    const location = asset.location
    const marker = location ? shownLocation(places, id, location, trails[id], profile) : null
    const since = currentStay(stayPoints(trails[id] ?? [], length), now, profile, trailPlaces(places, id))?.since ?? null

    const pending = new Set(walks.filter((walk) => !(walk.key in results)).map((walk) => walk.key))
    const frame: Frame = {
      time,
      kind,
      from: from ?? Infinity,
      newest: view?.newest ?? 0,
      recorded: new Segments(recorded),
      dots: (recorded?.dots ?? []).map((dot) => ({ at: xy(dot.center), to: dot.to })),
      walks: (shown?.walks ?? []).map((walk) => ({
        key: walk.key,
        t1: walk.points[0]!.time,
        t2: walk.points.at(-1)!.time,
        snapped: walk.snapped,
        pending: pending.has(walk.key),
      })),
    }
    s.frames++
    if (previous) account?.((time - previous.time) / 60_000)

    // Snap to paths: a walk drawn along its line, now drawn as recorded: while a new version of it is
    // asked for (a flash), or for good (a line lost), by when it was.
    const overlaps = (a: { t1: number; t2: number }, b: { t1: number; t2: number }) => a.t1 <= b.t2 && b.t1 <= a.t2
    for (const walk of frame.walks) if (walk.snapped) hadLines.set(`${walk.t1}-${walk.t2}`, walk)
    if (previous) {
      for (const before of previous.walks.filter((walk) => walk.snapped)) {
        if (frame.walks.some((walk) => walk.key === before.key && walk.snapped)) continue
        if (frame.walks.some((walk) => !walk.snapped && walk.pending && overlaps(walk, before))) {
          s.flashes++
          log(time, `flash: the walk of ${local(before.t1)} drawn as recorded`)
        }
      }
    }
    for (const walk of frame.walks) {
      if (walk.snapped || walk.pending || lost.has(walk.key) || neverHad.has(walk.key)) continue
      if (![...hadLines.values()].some((had) => overlaps(had, walk))) {
        neverHad.add(walk.key)
        continue
      }
      lost.add(walk.key)
      s.linesLost++
      log(time, `line lost: the walk of ${local(walk.t1)} drawn as recorded for good`)
    }

    // The trail changing: what's settled when a report comes; anything but its old end dropping off
    // with no report, or when the page is opened again.
    if (previous) {
      const left = (segment: Segment) => segment.t2 < frame.from
      const gone = previous.recorded.list.filter((segment) => !left(segment) && !frame.recorded.find(segment))
      const added = frame.recorded.list.filter((segment) => !previous!.recorded.find(segment))
      const near = (dot: { at: XY }, dots: { at: XY }[]) => dots.some((other) => metres(dot.at, other.at) <= SAME_METRES)
      const dotsGone = previous.dots.filter((dot) => dot.to >= frame.from && !near(dot, frame.dots))
      const dotsAdded = frame.dots.filter((dot) => !near(dot, previous!.dots))
      if (kind === 'report') {
        const settled = (time: number) => time < previous!.newest - SETTLED_MS
        const changed = [...gone, ...added].filter((segment) => settled(segment.t2))
        const dots = [...dotsGone, ...dotsAdded].filter((dot) => settled(dot.to)).length
        if (changed.length || dots) {
          s.pastChanges.frames++
          s.pastChanges.metres += lengthOf(changed)
          s.pastChanges.dots += dots
          log(time, `past change: ${Math.round(lengthOf(changed))} m of trail, ${dots} dots`)
        }
      } else {
        const changes = kind === 'tick' ? s.idleChanges : s.reloadChanges
        const dots = dotsGone.length + dotsAdded.length
        if (gone.length || added.length || dots) {
          changes.frames++
          changes.metres += lengthOf(gone) + lengthOf(added)
          changes.dots += dots
          log(
            time,
            `${kind === 'tick' ? 'idle' : 'reload'} change: ${Math.round(lengthOf(gone) + lengthOf(added))} m of trail, ${dots} dots`,
          )
        }
        if (kind === 'tick') {
          const faded = previous.recorded.list.some((segment) => {
            const now = frame.recorded.find(segment, true)
            return now && Math.abs(now.opacity - segment.opacity) > SAME_OPACITY
          })
          if (faded) s.idleChanges.fade++
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
        if (markerSeen.some((seen) => seen !== before && time - seen.time <= RETURN_MS && metres(seen.at, at) <= RETURN_METRES)) {
          s.marker.outAndBack++
        }
        log(time, `marker jump: ${Math.round(metres(before.at, at))} m`)
      }
      if (before && before.atPlace !== atPlace) s.marker.placeToggles++
      markerSeen.push({ time, at, atPlace })
      while (markerSeen.length > 1 && time - markerSeen[0]!.time > RETURN_MS) markerSeen.shift()
    }

    // "Here since": changes, going back in time, and back to what it said moments ago.
    if (said !== undefined && since !== said) {
      s.card.changes++
      if (said !== null && since !== null && since < said - 60_000) s.card.backwards++
      const shownLast = lastSaid.get(since)
      if (shownLast !== undefined && time - shownLast <= FLICKER_MS) s.card.flickers++
      lastSaid.set(said, time)
    }
    said = since

    // An hourly picture of the trail as it is: how much walking, how much of it far from every fix.
    if (time >= nextPicture) {
      nextPicture = (Math.floor(time / 3_600_000) + 1) * 3_600_000
      const fixes = view ? (trails[id] ?? []).filter((point) => point.valid && point.time >= view.oldest).map(xy) : []
      for (const walk of shown?.walks ?? []) {
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

    // Which labelled fixes are drawn: within DRAWN_METRES of the trail as drawn, worked out again when
    // the drawing changes.
    if (!sameDrawing(drawnLabels.drawing, shown)) {
      const lines = shown ? new Segments(shown).list : []
      drawnLabels = {
        drawing: shown,
        shares: labelFixes.map((fixes, index) => {
          const label = labels[index]!
          if (fixes.length === 0 || !view || view.oldest > label.to || label.from > view.newest) return 0
          const near = lines.filter((line) => line.t2 >= label.from - LABEL_SLACK_MS && line.t1 <= label.to + LABEL_SLACK_MS)
          return fixes.filter((fix) => near.some((line) => toSegment(fix, line) <= DRAWN_METRES)).length / fixes.length
        }),
      }
    }

    // Scored when the next frame comes: grey, the card while walking, the labelled reports.
    const shares = drawnLabels.shares
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
        const out = s.labels[index]!
        if (view && view.oldest <= label.to && label.from <= view.newest) out.inTrailMinutes += minutes
        if (label.kind === 'real' ? shares[index]! >= REAL_DRAWN_SHARE : shares[index]! > 0) out.drawnMinutes += minutes
        if (markerFix && markerFix.time >= label.from && markerFix.time <= label.to) out.markerMinutes += minutes
      })
    }
    previous = frame

    // Snap to paths asks for the walks it hasn't, once the trail has been still for DEBOUNCE_MS; the
    // answers are in by the next frame.
    const next = Math.min(nextTick, nextReload, arrivals[k]?.serverTime ?? Infinity)
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

  for (const changes of [s.pastChanges, s.idleChanges, s.reloadChanges]) changes.metres = Math.round(changes.metres)
  s.card.walkingMinutes = Math.round(s.card.walkingMinutes)
  s.card.walkingShownMinutes = Math.round(s.card.walkingShownMinutes)
  s.greyMinutes = Math.round(s.greyMinutes)
  s.picture = { drawnMetres: Math.round(s.picture.drawnMetres), farMetres: Math.round(s.picture.farMetres) }
  for (const label of s.labels) {
    label.inTrailMinutes = Math.round(label.inTrailMinutes * 10) / 10
    label.drawnMinutes = Math.round(label.drawnMinutes * 10) / 10
    label.markerMinutes = Math.round(label.markerMinutes * 10) / 10
  }
  return s
}

/** Whether two drawings draw the same: the same walks, as recorded or along the same lines, and rides. */
function sameDrawing(a: DrawnTrail | null, b: DrawnTrail | null): boolean {
  if (!a || !b) return a === b
  const key = (drawn: DrawnTrail) =>
    [
      ...drawn.walks.map((walk) => `${walk.key}${walk.snapped ? `:${walk.points.length}` : ''}`),
      ...drawn.rides.map((ride) => ride.points[0]!.time),
    ].join(' ')
  return key(a) === key(b)
}

/** How far a point is from a segment, in metres. */
function toSegment(point: XY, segment: Segment): number {
  const [dx, dy] = [segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dy) / length)) : 0
  return Math.hypot(point[0] - segment.a[0] - t * dx, point[1] - segment.a[1] - t * dy)
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
    ['frames', `${s.frames} (${Math.round(ms / 1000)} s)`],
    ['snap requests, flashes, lines lost', `${s.snapRequests}, ${s.flashes}, ${s.linesLost}`],
    ['past changes (frames, m, dots)', `${s.pastChanges.frames}, ${s.pastChanges.metres}, ${s.pastChanges.dots}`],
    [
      'idle changes (frames, m, dots; fading)',
      `${s.idleChanges.frames}, ${s.idleChanges.metres}, ${s.idleChanges.dots}; ${s.idleChanges.fade}`,
    ],
    ...(reload
      ? [
          ['reload changes (frames, m, dots)', `${s.reloadChanges.frames}, ${s.reloadChanges.metres}, ${s.reloadChanges.dots}`] as [
            string,
            string,
          ],
        ]
      : []),
    ['marker jumps, out and back, place toggles', `${s.marker.jumps}, ${s.marker.outAndBack}, ${s.marker.placeToggles}`],
    ['here since: changes, backwards, flickers', `${s.card.changes}, ${s.card.backwards}, ${s.card.flickers}`],
    ['here since while walking (min)', `${s.card.walkingShownMinutes} of ${s.card.walkingMinutes}`],
    ['grey (min)', `${s.greyMinutes}`],
    ['hourly pictures: walking drawn, far from fixes (m)', `${s.picture.drawnMetres}, ${s.picture.farMetres}`],
  ]
  for (const label of s.labels) {
    rows.push([
      `${label.kind}: ${label.what}`,
      `${label.fixMetres} m of fixes; in the trail ${label.inTrailMinutes} min, drawn ${label.drawnMinutes}; the marker on it ${label.markerMinutes}`,
    ])
  }
  const width = Math.max(...rows.map(([name]) => name.length))
  for (const [name, value] of rows) console.log(`  ${name.padEnd(width)}  ${value}`)
}

/**
 * Where these scores are worse than the baseline's, listed; as an exit code, 1 when anywhere, 2 when
 * the baseline replayed something else. Minutes move with the clock's ticks: a minute either way is the same.
 */
function compare(baseline: { run?: Run; scores?: Record<string, Score> }): number {
  if (!baseline.run || !baseline.scores || JSON.stringify(baseline.run) !== JSON.stringify(run)) {
    console.log(`\nThe baseline replayed something else: ${JSON.stringify(baseline.run)}, not ${JSON.stringify(run)}`)
    return 2
  }
  const worse: string[] = []
  const check = (name: string, before: number, after: number, { higherIsBetter = false, slack = 0 } = {}) => {
    if (higherIsBetter ? after < before - slack : after > before + slack) worse.push(`${name}: ${before} → ${after}`)
  }
  for (const [length, s] of Object.entries(scores)) {
    const b = baseline.scores[length]
    if (!b) continue
    check(`${length}: flashes`, b.flashes, s.flashes)
    check(`${length}: lines lost`, b.linesLost, s.linesLost)
    check(`${length}: past changes`, b.pastChanges.frames, s.pastChanges.frames)
    check(`${length}: idle changes`, b.idleChanges.frames, s.idleChanges.frames)
    check(`${length}: reload changes`, b.reloadChanges.frames, s.reloadChanges.frames)
    check(`${length}: marker jumps`, b.marker.jumps, s.marker.jumps)
    check(`${length}: marker place toggles`, b.marker.placeToggles, s.marker.placeToggles)
    check(`${length}: here since backwards`, b.card.backwards, s.card.backwards)
    check(`${length}: here since flickers`, b.card.flickers, s.card.flickers)
    check(`${length}: here since while walking (min)`, b.card.walkingShownMinutes, s.card.walkingShownMinutes, { slack: 1 })
    check(`${length}: grey (min)`, b.greyMinutes, s.greyMinutes, { slack: 1 })
    check(`${length}: drawn far from fixes (m)`, b.picture.farMetres, s.picture.farMetres, { slack: 10 })
    // Less drawn may be errors gone; much less, walks lost.
    check(`${length}: walking drawn (m)`, b.picture.drawnMetres, s.picture.drawnMetres, {
      higherIsBetter: true,
      slack: b.picture.drawnMetres * 0.1,
    })
    for (const label of s.labels) {
      const before = b.labels.find((other) => other.what === label.what)
      if (!before) continue
      const real = label.kind === 'real'
      check(`${length}: ${label.what}, drawn (min)`, before.drawnMinutes, label.drawnMinutes, { higherIsBetter: real, slack: 1 })
      if (!real) check(`${length}: ${label.what}, the marker on it (min)`, before.markerMinutes, label.markerMinutes, { slack: 1 })
    }
  }
  console.log(worse.length ? `\nWorse than the baseline:\n  ${worse.join('\n  ')}` : '\nNo worse than the baseline anywhere.')
  return worse.length ? 1 : 0
}
