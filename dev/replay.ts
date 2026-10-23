// The trail replay: plays a tracker's real reports through the map's own code, in the order they
// arrived and with the app's 15-second clock, as if the map had been open all along (or opened again
// every so often, --reload), and scores how the trail behaves while you watch it. Every change to how
// the trail is worked out or drawn should keep the score or make it better (see ARCHITECTURE.md →
// Trail → The replay). Dev only.
//
//   npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>]
//     [--reload <minutes>] [--unavailable <share>] [--baseline <score.json>] [--json <score.json>] [--events]
//
// With MAP_MATCHING_URL set (a Valhalla, as for the app), Snap to paths is on, as in the browser;
// --unavailable makes that share of its answers 'unavailable', as when Valhalla is down or slow.
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
import { matchableWalks, otherWalks } from '../src/lib/matching.ts'
import { placeCenter, placeOf, withinArea, type Place } from '../src/lib/places.ts'
import {
  assetVisits,
  currentStays,
  keepFrom,
  news,
  presences,
  quietAfter,
  shownAssets,
  startsInVisit,
  whileLoading,
  type Presence,
  type Visit,
} from '../src/lib/presence.ts'
import type { LatLon } from '../src/lib/segments.ts'
import { answered, snappedLines, toAsk, withAnswers, type AssetWalk, type SnapAnswer, type SnapState } from '../src/lib/snapLines.ts'
import { trailProfile } from '../src/lib/tracker.ts'
import {
  extendTrails,
  historyMinutes,
  historyStart,
  MAX_EXTRA_HISTORY_MS,
  MAX_HISTORY_MINUTES,
  keepEarlier,
  mergeHistory,
  MISSED_AFTER_MS,
  MISSED_SILENCE_MS,
  trailStart,
  type TrailLength,
  type TrailPoint,
  type Trails,
} from '../src/lib/trail.ts'
import {
  drawTrail,
  quietAssets,
  shownTrails,
  trailViews,
  type DrawnTrail,
  type TrailView,
  type TrailViewCache,
} from '../src/lib/trailGeometry.ts'
import { matchWalk } from '../src/server/matching.server.ts'
import { toPositionUpdate, toTrailPoint } from '../src/server/positions.server.ts'
import { parsePosition, type TraccarPosition } from '../src/server/traccar.server.ts'

// The server's config wants these; nothing here talks to Traccar or signs anything.
process.env.TRACCAR_URL ??= 'http://127.0.0.1:9'
process.env.SESSION_SECRET ??= 'replay-only-not-a-secret-'.repeat(2)

/** The app's clock (useNow in useLiveAssets). */
const TICK_MS = 15_000
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
/**
 * Walking, for the card: a fix this fresh, and one at least WALKING_METRES from it within
 * WALKING_WITHIN_MS, the fresh one more than WALKING_AWAY_METRES outside the asset's places (indoors,
 * fixes scatter more than that).
 */
const WALKING_FRESH_MS = 2 * 60 * 1000
const WALKING_METRES = 60
const WALKING_WITHIN_MS = 5 * 60 * 1000
const WALKING_AWAY_METRES = 25
/** A departure back at the same place within this long was a false alarm, or not worth one. */
const BRIEF_MS = 3 * 60 * 1000
/** An arrival or departure this recent is news, a banner (as in useLiveAssets). */
const NEWS_MS = 10 * 60 * 1000
/** Drawn this far from every fix, it's made up. */
const FAR_METRES = 40
/** A walk's line moving this far, but for its last LINE_HEAD_MS, when a longer version of it comes, shows. */
const LINE_SHIFT_METRES = 10
const LINE_HEAD_MS = 2 * 60 * 1000
/**
 * A labelled fix this close to the trail drawn for its time (give or take LABEL_SLACK_MS: a snapped
 * line's points between fixes have times by distance) is drawn; a real outing with this share of its
 * fixes drawn is.
 */
const DRAWN_METRES = 10
const LABEL_SLACK_MS = 5 * 60 * 1000
const REAL_DRAWN_SHARE = 0.8

type Label = { kind: 'error' | 'likely-error' | 'real'; from: number; to: number; what: string }
type Fixture = { positions: (TraccarPosition & { serverTime: number })[]; places: Place[]; labels: Label[]; deviceId: number }

/** What was replayed: scores only compare when this is the same. */
type Run = { reports: number; opened: string; closed: string; snapping: boolean; reload: number | null; unavailable?: number }

type Score = {
  frames: number
  /**
   * Snap to paths: walks asked for; a walk drawn along its line, then as recorded while its new version
   * is asked for, or for good; and a walk's line moving, but for its newest part, when a new version
   * comes (how often, how far for 9 in 10, at most, and how often over LINE_SHIFT_METRES).
   */
  snapRequests: number
  flashes: number
  linesLost: number
  lineShifts?: { count: number; p90: number; max: number; over: number }
  /** The trail changing more than SETTLED_MS before the newest fix when a report comes: lines and dots. */
  pastChanges: { frames: number; metres: number; dots: number }
  /** The trail changing with no report (the clock alone), but for its old end dropping off; and its fading. */
  idleChanges: { frames: number; metres: number; dots: number; fade: number }
  /** The trail changing when the page is opened again (--reload), but for its old end dropping off. */
  reloadChanges: { frames: number; metres: number; dots: number }
  marker: { jumps: number; outAndBack: number; placeToggles: number }
  /**
   * Where the asset is as its places go (see presence.ts): departures and arrivals, how long after the
   * fact they were known (for half, at most, in seconds), the banners the app shows ("Kofi left Home"),
   * and how many departures were back at the place within BRIEF_MS.
   */
  presence?: {
    departures: number
    lagP50: number
    lagMax: number
    banners: number
    brief: number
    arrivals?: number
    arrivalLagP50?: number
    arrivalLagMax?: number
    /** Times the page opened again would show it out of a place while its history loads, on a location its trail has (see whileLoading). */
    whileLoading?: number
  }
  card: { changes: number; backwards: number; flickers: number; walkingMinutes: number; walkingShownMinutes: number }
  greyMinutes: number
  /** Hourly pictures of the trail: how much walking is drawn, and how much of it far from every fix. */
  picture: { drawnMetres: number; farMetres: number }
  /**
   * For each label: its fixes' length; minutes its time was in the trail drawn, and that it was drawn
   * (an error: any of its fixes; a real outing: REAL_DRAWN_SHARE of them); and minutes the marker was on it.
   */
  labels: {
    kind: Label['kind']
    what: string
    fixMetres: number
    inTrailMinutes: number
    drawnMinutes: number
    markerMinutes: number
    /** Whether the asset left a place then, as its presence has it. */
    left?: boolean
  }[]
}

type XY = [number, number]
type Segment = { a: XY; b: XY; t1: number; t2: number; opacity: number }
/** A walk as drawn, with its time span: along a snapped line, and whether its version was answered yet; and its points. */
type Walk = { key: string; t1: number; t2: number; snapped: boolean; pending: boolean; points: { at: XY; time: number }[] }

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
  'usage: npm run replay -- <fixture folder> [--trail 60,360,1440] [--from <time>] [--to <time>] [--reload <minutes>] [--unavailable <share>] [--baseline <file>] [--json <file>] [--events]'
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    trail: { type: 'string', default: '60,360,1440' },
    from: { type: 'string' },
    to: { type: 'string' },
    reload: { type: 'string' },
    unavailable: { type: 'string' },
    baseline: { type: 'string' },
    json: { type: 'string' },
    events: { type: 'boolean', default: false },
  },
})
const lengths = values.trail.split(',').map((value): TrailLength => (value === 'today' ? 'today' : Number(value)))
const reload = values.reload === undefined ? null : Number(values.reload)
const unavailable = values.unavailable === undefined || Number(values.unavailable) === 0 ? undefined : Number(values.unavailable)
const bad = (value: number | undefined) => value !== undefined && !(Number.isFinite(value) && value > 0)
if (
  positionals.length !== 1 ||
  lengths.some((length) => length !== 'today' && !(Number.isFinite(length) && length >= 0)) ||
  bad(reload ?? undefined) ||
  (unavailable !== undefined && !(unavailable >= 0 && unavailable < 1)) ||
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
  unavailable,
}

console.log(
  `${fixture.positions.length} reports, ${local(first)} to ${local(last)}; open ${local(opened)} to ${local(closed)}` +
    `${reload ? `, opened again every ${reload} min` : ''}; Snap to paths ${snapping ? 'on' : 'off (no MAP_MATCHING_URL)'}` +
    `${unavailable ? `, ${unavailable * 100}% of its answers unavailable` : ''};` +
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
const week = presenceOverAll()
printWeek(week)
// The fixture the whole-fixture pass went over, to compare it with a baseline whatever else it replayed.
const replayed = { reports: fixture.positions.length, first: new Date(first).toISOString(), last: new Date(last).toISOString() }
if (values.json) fs.writeFileSync(values.json, JSON.stringify({ run, scores, fixture: replayed, week }, null, 1))
if (values.baseline) {
  process.exitCode = compare(JSON.parse(fs.readFileSync(values.baseline, 'utf8')) as Baseline)
}

/** A departure or arrival as presence has it (see presence.ts): which, where, when, and when it was known. */
type Change = { left: boolean; place: number; time: number; known: number }
type Baseline = { run?: Run; scores?: Record<string, Score>; fixture?: typeof replayed; week?: Change[] }

/**
 * Where the asset is as its places go, over the whole fixture, with the page open from its first
 * report (the trail lengths' replays open later, so each starts with all of its history): every
 * departure and arrival, when it was known, as reports come and the clock ticks.
 */
function presenceOverAll(): Change[] {
  const { deviceId: id, places, positions } = fixture
  const changes = new Map<string, Change>()
  let trails: Trails = {}
  let assets: Asset[] = [{ id, name: 'replay', status: 'online', lastUpdate: null, location: null, placeIds: [] }]
  // The clock's latest tick, as the page has it (see useNow), and its next.
  let [k, clock, next] = [0, first, first]
  // Until the tracker has been quiet after its last report for as long as any tracker takes to have
  // gone quiet (see quietAfter).
  const end = last + quietAfter(trailProfile('standard')) + TICK_MS
  while (next <= end) {
    const time = Math.min(next, positions[k]?.serverTime ?? Infinity)
    if (time === positions[k]?.serverTime) {
      const updates = [toPositionUpdate(positions[k++]!)]
      assets = applyUpdates(assets, updates).assets
      trails = extendTrails(trails, updates, MAX_HISTORY_MINUTES, time)
    } else [clock, next] = [next, next + TICK_MS]
    const presence = presences(trails, places, { [id]: assets[0]!.tracker }, clock, assets)[id]
    if (!presence || (presence.place === null && presence.left === undefined) || (presence.place !== null && !presence.began)) continue
    const change = { left: presence.place === null, place: presence.place ?? presence.left!, time: presence.since, known: time }
    const key = `${change.left}-${change.place}-${change.time}`
    if (changes.has(key)) continue
    changes.set(key, change)
    const what = change.left ? `left ${change.place} at` : `at ${change.place} since`
    log(time, `${what} ${local(change.time)}, known after ${Math.round((time - change.time) / 1000)} s (whole fixture)`)
  }
  return [...changes.values()].sort((a, b) => a.time - b.time)
}

function printWeek(week: Change[]) {
  const lags = (left: boolean) =>
    week
      .filter((change) => change.left === left)
      .map((change) => (change.known - change.time) / 1000)
      .sort((a, b) => a - b)
  const [out, back] = [lags(true), lags(false)]
  const half = (lag: number[]) => Math.round(lag[Math.floor(lag.length / 2)] ?? 0)
  console.log(
    `\nWhere it is over the whole fixture: ${out.length} departures, known after ${half(out)} s for half, ${Math.round(out.at(-1) ?? 0)} s at most;` +
      ` ${back.length} arrivals, ${half(back)} s, ${Math.round(back.at(-1) ?? 0)} s`,
  )
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
    lineShifts: { count: 0, p90: 0, max: 0, over: 0 },
    pastChanges: { frames: 0, metres: 0, dots: 0 },
    idleChanges: { frames: 0, metres: 0, dots: 0, fade: 0 },
    reloadChanges: { frames: 0, metres: 0, dots: 0 },
    marker: { jumps: 0, outAndBack: 0, placeToggles: 0 },
    presence: {
      departures: 0,
      lagP50: 0,
      lagMax: 0,
      banners: 0,
      brief: 0,
      arrivals: 0,
      arrivalLagP50: 0,
      arrivalLagMax: 0,
      whileLoading: 0,
    },
    card: { changes: 0, backwards: 0, flickers: 0, walkingMinutes: 0, walkingShownMinutes: 0 },
    greyMinutes: 0,
    picture: { drawnMetres: 0, farMetres: 0 },
    labels: labels.map((label, index) => {
      const fixes = labelFixes[index]!
      const fixMetres = Math.round(fixes.slice(1).reduce((sum, p, i) => sum + metres(fixes[i]!, p), 0))
      return { kind: label.kind, what: label.what, fixMetres, inTrailMinutes: 0, drawnMinutes: 0, markerMinutes: 0, left: false }
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
    let points = fetched(start, time, time)
    // A history that starts inside the visit it's at goes further back, a day at a time (as useLiveAssets).
    const tracker = latest && applyUpdates([empty], [toPositionUpdate(latest)]).assets[0]!.tracker
    for (let first = points[0]?.time; first !== undefined;) {
      if (!startsInVisit(assetVisits({ [id]: points }, places, { [id]: tracker }, time)[id] ?? [])) break
      const from = Math.max(first - MAX_HISTORY_MINUTES * 60 * 1000, time - MAX_EXTRA_HISTORY_MS)
      const more = from < first ? fetched(from, first, time) : []
      if (more.length === 0) break
      points = mergeHistory(points, more)
      if (points[0]!.time === first) break
      first = points[0]!.time
    }
    return { trails: { [id]: points } as Trails, latest }
  }
  /** The asset's reports from `from` to `to`, as Traccar has them at `at`. */
  function fetched(from: number, to: number, at: number): TrailPoint[] {
    return fixture.positions
      .filter((position) => position.serverTime <= at && Date.parse(position.fixTime) >= from && Date.parse(position.fixTime) <= to)
      .map(toTrailPoint)
      .sort((a, b) => a.time - b.time)
  }
  const empty: Asset = { id, name: 'replay', status: 'online', lastUpdate: null, location: null, placeIds: [] }
  const loaded = load(opened)
  let trails = loaded.trails
  let assets = loaded.latest ? applyUpdates([empty], [toPositionUpdate(loaded.latest)]).assets : [empty]
  const arrivals = fixture.positions.filter((position) => position.serverTime > opened && position.serverTime <= closed)

  // The browser's Snap to paths (useSnappedWalks): what it knows of each walk; and the server's
  // answers, 'unavailable' for a share of them (--unavailable), by walk version and attempt.
  let snaps: SnapState = new Map()
  const attempts = new Map<string, number>()
  const ask = async (walk: AssetWalk): Promise<SnapAnswer> => {
    const attempt = (attempts.get(walk.signature) ?? 0) + 1
    attempts.set(walk.signature, attempt)
    if (unavailable && hashShare(`${walk.signature}/${attempt}`) < unavailable) return 'unavailable'
    return matchWalk(walk.points)
  }
  const shifts: number[] = []
  // Walks drawn along a line, by their time span, and whether that line was lost since (drawn as recorded, answered).
  const hadLines = new Map<string, { t1: number; t2: number; lost: boolean }>()

  const cache: TrailViewCache = new Map()
  let previous: Frame | null = null
  // What the last frame showed, scored once it's known how long it showed (until the next frame).
  let account: ((minutes: number) => void) | null = null
  const markerSeen: { time: number; at: XY; atPlace: boolean }[] = []
  // Where it was as of the frame before, departures and arrivals seen (by place and time) and when
  // first, and the departures it left by.
  let wasAt: Presence | null = null
  let wasVisits: Visit[] | null = null
  const departures = new Map<string, { time: number; known: number | null; place: number }>()
  const cameTo = new Map<string, { time: number; known: number | null }>()
  const left: { place: number; time: number }[] = []
  // "Here since" as it is, and when each time it showed was last shown.
  let said: number | null | undefined
  const lastSaid = new Map<number | null, number>()
  let nextPicture = Math.ceil(opened / 3_600_000) * 3_600_000
  // The labelled fixes drawn, as of the drawings they were worked out on.
  let drawnLabels: { drawing: DrawnTrail | null; recorded: DrawnTrail | null; shares: number[] } = {
    drawing: null,
    recorded: null,
    shares: labels.map(() => 0),
  }

  let now = opened
  let nextTick = opened + TICK_MS
  let nextReload = reload ? opened + reload * 60_000 : Infinity
  // The reports a silence may have missed, fetched a minute after it ended (see MISSED_SILENCE_MS);
  // and from when the visit it's at stays in its history (see keepFrom).
  let missed = null as { at: number; from: number } | null
  let keep: Record<number, number> = {}
  for (let k = 0; ;) {
    // The next report, or the page opened again, or the missed reports coming, or the clock's next
    // tick, whichever comes first.
    const arrival = arrivals[k]
    const time = Math.min(nextTick, nextReload, missed?.at ?? Infinity, arrival?.serverTime ?? Infinity)
    if (time > closed) break
    let kind: Frame['kind']
    // What a history load or the missed reports found out, for the banners (as useLiveAssets).
    let fromLoad = false
    if (time === nextReload) {
      kind = 'reload'
      fromLoad = true
      nextReload += reload! * 60_000
      // While the history loads, the page has the trail it had and the latest location: never newer
      // here (no report is missed), so where the asset is mustn't change (see whileLoading).
      const trackers = { [id]: assets[0]!.tracker }
      const found = presences(trails, places, trackers, now, assets)
      if (whileLoading(found, assets, places, trails)[id] !== found[id]) {
        s.presence!.whileLoading!++
        log(time, 'while loading: out of its place on a location its trail has')
      }
      trails = keepEarlier(load(time).trails, trails, keep)
    } else if (time === missed?.at) {
      kind = 'report'
      fromLoad = true
      const merged = mergeHistory(trails[id] ?? [], fetched(missed.from, time, time))
      if (merged.length > (trails[id]?.length ?? 0))
        log(time, `missed reports: ${merged.length - (trails[id]?.length ?? 0)} since ${local(missed.from)}`)
      trails = { ...trails, [id]: merged }
      missed = null
    } else if (time === nextTick) {
      kind = 'tick'
      now = nextTick
      nextTick += TICK_MS
    } else {
      kind = 'report'
      const updates = [toPositionUpdate(arrival!)]
      assets = applyUpdates(assets, updates).assets
      const last = trails[id]?.at(-1)
      if (!missed && last && Date.parse(arrival!.fixTime) - last.time > MISSED_SILENCE_MS)
        missed = { at: time + MISSED_AFTER_MS, from: last.time }
      trails = extendTrails(trails, updates, historyLength, time, keep)
      k++
    }
    const asset = assets[0]!
    const profile = trailProfile(asset.tracker)

    // What the map shows (useLiveAssets → setTrails, useSnappedWalks, the marker, the details card).
    const from = trailStart(length, now)
    const trackers = { [id]: asset.tracker }
    const quiet = new Set(quietAssets(trails, trackers, now))
    const view: TrailView | null = shownTrails(trailViews(trails, places, trackers, cache, quiet), from)[id] ?? null
    const walks: AssetWalk[] =
      snapping && view ? matchableWalks(view.pieces, () => false, profile).map((walk) => ({ ...walk, asset: id })) : []
    const others: AssetWalk[] = snapping && view ? otherWalks(view.pieces, walks).map((walk) => ({ ...walk, asset: id })) : []
    const shown = view ? drawTrail(view, snappedLines(walks, snaps, others)[id]) : null
    const recorded = view ? drawTrail(view, {}) : null
    const location = asset.location
    const visits = assetVisits({ [id]: trails[id] ?? [] }, places, trackers, now)
    const presence = presences({ [id]: trails[id] ?? [] }, places, trackers, now, assets, visits)[id] ?? null
    const keeping = keepFrom(trails[id] ?? [], visits[id] ?? [], places, id, profile)
    keep = keeping === undefined ? {} : { [id]: keeping }
    const marker = shownAssets(assets, trails, presence ? { [id]: presence } : {}, places)[0]!.location
    const atPlace =
      !!marker &&
      places.some((place) => {
        const center = placeCenter(place.area)
        return place.assetIds.includes(id) && center.lat === marker.lat && center.lon === marker.lon
      })
    // "Here since": at a place, since it came; elsewhere, at a stop the map draws.
    const where = presence ? { [id]: presence } : {}
    const since =
      presence?.place != null ? presence.since : (currentStays(trails, length, now, { [id]: asset.tracker }, where)[id]?.since ?? null)

    // Departures and arrivals as they become known (not those the page found when it opened), and the
    // banners the app shows when where it is changes.
    if (presence) {
      const known = wasAt ? time : null
      if (presence.place === null && presence.left !== undefined) {
        const key = `${presence.left}-${presence.since}`
        if (!departures.has(key)) {
          departures.set(key, { time: presence.since, known, place: presence.left })
          if (known)
            log(time, `left ${presence.left} at ${local(presence.since)}, known after ${Math.round((known - presence.since) / 1000)} s`)
        }
      }
      if (presence.place !== null && presence.began) {
        const key = `${presence.place}-${presence.since}`
        if (!cameTo.has(key)) {
          cameTo.set(key, { time: presence.since, known })
          if (known)
            log(time, `at ${presence.place} since ${local(presence.since)}, known after ${Math.round((known - presence.since) / 1000)} s`)
        }
      }
      // The banners: as it happens; what the page opened again finds out, if it's recent.
      const said = wasVisits ? news(wasVisits, visits[id] ?? []).filter((change) => !fromLoad || time - change.time <= NEWS_MS) : []
      if (said.length) {
        s.presence!.banners++
        for (const change of said) log(time, `banner: ${change.arrived ? 'arrived at' : 'left'} ${change.placeId} at ${local(change.time)}`)
      }
      wasVisits = visits[id] ?? []
      if (wasAt && wasAt.place !== presence.place) {
        if (presence.place === null && presence.left !== undefined) left.push({ place: presence.left, time: presence.since })
        const back =
          presence.place !== null &&
          left.some((out) => out.place === presence.place && presence.since >= out.time && presence.since - out.time <= BRIEF_MS)
        if (back) {
          s.presence!.brief++
          log(time, `brief: back at ${presence.place} within ${BRIEF_MS / 60_000} min`)
        }
      }
      wasAt = presence
    }

    const pending = new Set(walks.filter((walk) => !answered(walk, snaps)).map((walk) => walk.id))
    const frame: Frame = {
      time,
      kind,
      from: from ?? Infinity,
      newest: view?.newest ?? 0,
      recorded: new Segments(recorded),
      dots: (recorded?.dots ?? []).map((dot) => ({ at: xy(dot.center), to: dot.to })),
      walks: (shown?.walks ?? []).map((walk) => ({
        key: walk.key,
        // A hop between two stays is drawn at one time: its span is from the one stay to the other.
        t1: walk.hop ? Number(walk.key.split('-')[1]) : walk.points[0]!.time,
        t2: walk.hop ? Number(walk.key.split('-')[2]) : walk.points.at(-1)!.time,
        snapped: walk.snapped,
        pending: pending.has(walk.key),
        points: walk.points.map((point) => ({ at: xy(point), time: point.time })),
      })),
    }
    s.frames++
    if (previous) account?.((time - previous.time) / 60_000)

    // Snap to paths: a walk drawn along its line, now drawn as recorded: while a new version of it is
    // asked for (a flash), or for good (a line lost), by when it was.
    const overlaps = (a: { t1: number; t2: number }, b: { t1: number; t2: number }) => a.t1 <= b.t2 && b.t1 <= a.t2
    for (const walk of frame.walks) if (walk.snapped) hadLines.set(`${walk.t1}-${walk.t2}`, { t1: walk.t1, t2: walk.t2, lost: false })
    if (previous) {
      for (const before of previous.walks.filter((walk) => walk.snapped)) {
        if (frame.walks.some((walk) => walk.key === before.key && walk.snapped)) continue
        if (frame.walks.some((walk) => !walk.snapped && walk.pending && overlaps(walk, before))) {
          s.flashes++
          log(time, `flash: the walk of ${local(before.t1)} drawn as recorded`)
        }
      }
    }
    // A walk's line moving when a new version comes: how far its points move, but for its newest part,
    // and for the time both versions have (a walk whose end became a stay keeps its line up to its new end).
    if (previous) {
      for (const walk of frame.walks.filter((walk) => walk.snapped)) {
        const before = previous.walks.find((other) => other.key === walk.key && other.snapped)
        if (!before || samePoints(before.points, walk.points)) continue
        const until = Math.min(before.t2 - LINE_HEAD_MS, walk.t2)
        const settled = before.points.filter((point) => point.time <= until)
        if (settled.length === 0) continue
        // Either way: a point of the old line off the new one, or of the new line (but its newest part) off the old.
        const newer = walk.points.filter((point) => point.time <= until)
        const shift = Math.max(
          ...settled.map((point) => toLine(point.at, walk.points)),
          ...newer.map((point) => toLine(point.at, before.points)),
        )
        if (shift < 1) continue
        shifts.push(shift)
        if (shift > LINE_SHIFT_METRES) log(time, `line shift: the walk of ${local(walk.t1)} moved ${Math.round(shift)} m`)
      }
    }
    for (const walk of frame.walks) {
      if (walk.snapped || walk.pending) continue
      // Each version of the walk had its line: lost once.
      const lines = [...hadLines.values()].filter((had) => !had.lost && overlaps(had, walk))
      if (lines.length === 0) continue
      for (const had of lines) had.lost = true
      s.linesLost++
      log(time, `line lost: the walk of ${local(walk.t1)} drawn as recorded, answered`)
    }
    // Spans long gone from the trail are no use.
    for (const [key, had] of hadLines) if (had.t2 < frame.from - 3_600_000) hadLines.delete(key)

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

    // Which labelled fixes are drawn: within DRAWN_METRES of the trail drawn for their time, worked out
    // again when it changes. An error as the map shows it; a real outing as worked out, without Snap to
    // paths, whose line can be some way from weak fixes that are drawn all the same.
    if (!sameDrawing(drawnLabels.drawing, shown) || !sameDrawing(drawnLabels.recorded, recorded)) {
      const [lines, recordedLines] = [shown ? new Segments(shown).list : [], recorded ? new Segments(recorded).list : []]
      drawnLabels = {
        drawing: shown,
        recorded,
        shares: labelFixes.map((fixes, index) => {
          const label = labels[index]!
          if (fixes.length === 0 || !view || view.oldest > label.to || label.from > view.newest) return 0
          const near = (label.kind === 'real' ? recordedLines : lines).filter(
            (line) => line.t2 >= label.from - LABEL_SLACK_MS && line.t1 <= label.to + LABEL_SLACK_MS,
          )
          return fixes.filter((fix) => near.some((line) => toSegment(fix, line) <= DRAWN_METRES)).length / fixes.length
        }),
      }
    }

    // Scored when the next frame comes: grey, the card while walking, the labelled reports.
    const shares = drawnLabels.shares
    // The fix the marker is on, where it isn't at a place's centre.
    const markerFix =
      marker && !atPlace
        ? (trails[id] ?? []).findLast((point) => point.valid && point.lat === marker.lat && point.lon === marker.lon)
        : undefined
    const walking = isWalking(trails[id] ?? [], time, places)
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

    // Snap to paths asks for the walks it hasn't answers for as they are, as soon as they change, one
    // request at a time; the answers are in by the next frame.
    const asking = toAsk(walks, snaps, time)
    if (asking.length) {
      const answers = await Promise.all(asking.map(ask))
      s.snapRequests += asking.length
      snaps = withAnswers(snaps, asking, answers, time, [...walks, ...others])
    }
  }
  if (previous) account?.((closed - previous.time) / 60_000)

  for (const changes of [s.pastChanges, s.idleChanges, s.reloadChanges]) changes.metres = Math.round(changes.metres)
  const lagsOf = (seen: Map<string, { time: number; known: number | null }>) =>
    [...seen.values()].flatMap((one) => (one.known === null ? [] : [(one.known - one.time) / 1000])).sort((a, b) => a - b)
  const [lags, arrivalLags] = [lagsOf(departures), lagsOf(cameTo)]
  s.presence = {
    ...s.presence!,
    departures: lags.length,
    lagP50: Math.round(lags[Math.floor(lags.length / 2)] ?? 0),
    lagMax: Math.round(lags.at(-1) ?? 0),
    arrivals: arrivalLags.length,
    arrivalLagP50: Math.round(arrivalLags[Math.floor(arrivalLags.length / 2)] ?? 0),
    arrivalLagMax: Math.round(arrivalLags.at(-1) ?? 0),
  }
  labels.forEach((label, index) => {
    s.labels[index]!.left = [...departures.values()].some(
      (departure) => departure.time >= label.from - 60_000 && departure.time <= label.to + 60_000,
    )
  })
  shifts.sort((a, b) => a - b)
  s.lineShifts = {
    count: shifts.length,
    p90: Math.round(shifts[Math.floor(shifts.length * 0.9)] ?? 0),
    max: Math.round(shifts.at(-1) ?? 0),
    over: shifts.filter((shift) => shift > LINE_SHIFT_METRES).length,
  }
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
      ...drawn.walks.map((walk) => `${walk.key}:${walk.points.length}:${walk.snapped}:${walk.current}`),
      ...drawn.rides.map((ride) => ride.points[0]!.time),
    ].join(' ')
  return key(a) === key(b)
}

/** Whether two walks' points are the same, as drawn. */
function samePoints(a: { at: XY }[], b: { at: XY }[]): boolean {
  return a.length === b.length && a.every((point, index) => metres(point.at, b[index]!.at) < 0.5)
}

/** How far a point is from a line through these points, in metres. */
function toLine(point: XY, line: { at: XY }[]): number {
  if (line.length === 1) return metres(point, line[0]!.at)
  let nearest = Infinity
  for (let i = 1; i < line.length; i++) {
    nearest = Math.min(nearest, toSegment(point, { a: line[i - 1]!.at, b: line[i]!.at, t1: 0, t2: 0, opacity: 0 }))
  }
  return nearest
}

/** A share between 0 and 1 for a string, the same each time. */
function hashShare(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0) / 2 ** 32
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

/** Walking right now, by the fixes: see WALKING_FRESH_MS. */
function isWalking(points: TrailPoint[], now: number, places: Place[]): boolean {
  const fixes = points.filter((point) => point.valid && point.time > now - WALKING_WITHIN_MS && point.time <= now)
  const newest = fixes.at(-1)
  if (!newest || now - newest.time > WALKING_FRESH_MS || places.some((place) => withinArea(place.area, newest, WALKING_AWAY_METRES)))
    return false
  return fixes.some((fix) => metres(xy(fix), xy(newest)) >= WALKING_METRES)
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
    [
      'lines moving (times; m for 9 in 10, at most; over 10 m)',
      `${s.lineShifts?.count}; ${s.lineShifts?.p90}, ${s.lineShifts?.max}; ${s.lineShifts?.over}`,
    ],
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
    [
      'departures, known after (s, half; at most), banners, back soon',
      `${s.presence?.departures}, ${s.presence?.lagP50}; ${s.presence?.lagMax}, ${s.presence?.banners}, ${s.presence?.brief}`,
    ],
    [
      'arrivals, known after (s, half; at most); out while loading',
      `${s.presence?.arrivals}, ${s.presence?.arrivalLagP50}; ${s.presence?.arrivalLagMax}; ${s.presence?.whileLoading ?? 0}`,
    ],
    ['here since: changes, backwards, flickers', `${s.card.changes}, ${s.card.backwards}, ${s.card.flickers}`],
    ['here since while walking (min)', `${s.card.walkingShownMinutes} of ${s.card.walkingMinutes}`],
    ['grey (min)', `${s.greyMinutes}`],
    ['hourly pictures: walking drawn, far from fixes (m)', `${s.picture.drawnMetres}, ${s.picture.farMetres}`],
  ]
  for (const label of s.labels) {
    rows.push([
      `${label.kind}: ${label.what}`,
      `${label.fixMetres} m of fixes; in the trail ${label.inTrailMinutes} min, drawn ${label.drawnMinutes}; the marker on it ${label.markerMinutes}; left ${label.left ? 'yes' : 'no'}`,
    ])
  }
  const width = Math.max(...rows.map(([name]) => name.length))
  for (const [name, value] of rows) console.log(`  ${name.padEnd(width)}  ${value}`)
}

/**
 * Where these scores are worse than the baseline's, listed; as an exit code, 1 when anywhere, 2 when
 * the baseline replayed something else. Minutes move with the clock's ticks: a minute either way is the same.
 */
function compare(baseline: Baseline): number {
  const sameRun = !!baseline.run && !!baseline.scores && JSON.stringify(baseline.run) === JSON.stringify(run)
  if (!sameRun) console.log(`\nThe baseline replayed something else: ${JSON.stringify(baseline.run)}, not ${JSON.stringify(run)}`)
  const worse: string[] = []
  const check = (name: string, before: number, after: number, { higherIsBetter = false, slack = 0 } = {}) => {
    if (higherIsBetter ? after < before - slack : after > before + slack) worse.push(`${name}: ${before} → ${after}`)
  }
  // Neither more nor fewer is better as such (false alarms gone, or real ones missed): a change to look at.
  const changed = (name: string, before: number | undefined, after: number | undefined, slack = 0) => {
    if (before !== undefined && after !== undefined && Math.abs(after - before) > slack) worse.push(`${name} changed: ${before} → ${after}`)
  }
  for (const [length, s] of Object.entries(sameRun ? scores : {})) {
    const b = baseline.scores![length]
    if (!b) continue
    check(`${length}: flashes`, b.flashes, s.flashes)
    check(`${length}: lines lost`, b.linesLost, s.linesLost)
    if (b.lineShifts && s.lineShifts) check(`${length}: lines moving over ${LINE_SHIFT_METRES} m`, b.lineShifts.over, s.lineShifts.over)
    for (const [name, before, after] of [
      ['past', b.pastChanges, s.pastChanges],
      ['idle', b.idleChanges, s.idleChanges],
      ['reload', b.reloadChanges, s.reloadChanges],
    ] as const) {
      check(`${length}: ${name} changes`, before.frames, after.frames)
      check(`${length}: ${name} changes (m)`, before.metres, after.metres, { slack: 10 })
      check(`${length}: ${name} changes (dots)`, before.dots, after.dots)
    }
    check(`${length}: fading with no report`, b.idleChanges.fade, s.idleChanges.fade)
    check(`${length}: marker jumps`, b.marker.jumps, s.marker.jumps)
    check(`${length}: marker place toggles`, b.marker.placeToggles, s.marker.placeToggles)
    if (b.presence && s.presence) {
      changed(`${length}: departures`, b.presence.departures, s.presence.departures)
      changed(`${length}: arrivals`, b.presence.arrivals, s.presence.arrivals)
      changed(`${length}: banners`, b.presence.banners, s.presence.banners)
      check(`${length}: departures back soon`, b.presence.brief, s.presence.brief)
      check(`${length}: out while loading`, b.presence.whileLoading ?? 0, s.presence.whileLoading ?? 0)
      check(`${length}: departures known after (s, half)`, b.presence.lagP50, s.presence.lagP50, { slack: 5 })
      check(`${length}: departures known after (s, at most)`, b.presence.lagMax, s.presence.lagMax, { slack: 15 })
      if (b.presence.arrivalLagP50 !== undefined && s.presence.arrivalLagP50 !== undefined) {
        check(`${length}: arrivals known after (s, half)`, b.presence.arrivalLagP50, s.presence.arrivalLagP50, { slack: 5 })
        check(`${length}: arrivals known after (s, at most)`, b.presence.arrivalLagMax!, s.presence.arrivalLagMax!, { slack: 15 })
      }
    }
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
      // A real outing left by, an error not.
      if (before.left !== undefined && label.left !== undefined && label.left !== real && before.left === real) {
        worse.push(`${length}: ${label.what}, left: ${before.left ? 'yes' : 'no'} → ${label.left ? 'yes' : 'no'}`)
      }
      if (!real) check(`${length}: ${label.what}, the marker on it (min)`, before.markerMinutes, label.markerMinutes, { slack: 1 })
    }
  }
  // Over the whole fixture: each departure or arrival there or not, or known a minute later or more.
  if (baseline.week && JSON.stringify(baseline.fixture) === JSON.stringify(replayed)) {
    const key = (change: Change) => `${change.left}-${change.place}-${change.time}`
    const before = new Map(baseline.week.map((change) => [key(change), change]))
    const after = new Map(week.map((change) => [key(change), change]))
    const what = (change: Change) => `${change.left ? 'left' : 'arrived at'} ${change.place} at ${local(change.time)}`
    for (const [k, change] of before) if (!after.has(k)) worse.push(`whole fixture: no longer ${what(change)}`)
    for (const [k, change] of after) {
      const was = before.get(k)
      if (!was) worse.push(`whole fixture: now ${what(change)}`)
      else if (change.known - was.known >= 60_000)
        worse.push(`whole fixture: ${what(change)}, known ${Math.round((change.known - was.known) / 1000)} s later`)
    }
  }
  const compared = sameRun ? 'anywhere' : "over the whole fixture (the trail scores weren't compared)"
  console.log(worse.length ? `\nWorse than the baseline:\n  ${worse.join('\n  ')}` : `\nNo worse than the baseline ${compared}.`)
  return sameRun ? (worse.length ? 1 : 0) : 2
}
