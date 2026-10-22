import { MAX_WALKS_PER_REQUEST, type MatchablePoint, type MatchableWalk } from './matching.ts'
import type { SnappedPoint } from './snap.ts'

// Snap to paths in the browser: what the server has answered for each walk, which walks to ask for
// next, and the line to draw for each (see useSnappedWalks, which keeps it, and dev/replay.ts, which
// runs the same). A walk keeps its id as it grows (see walkId), so its line is kept while the longer
// version is asked for: drawn up to the last fix both versions share, with the fixes since as
// recorded, rather than the whole walk as recorded for a moment every time a fix comes. Asking for a
// walk 30 s longer each time, that was the walk flashing between its line and its zigzag of fixes
// twice a minute while it went on: 645 times on a week of Kofi's, now 0 (see dev/replay.ts). No
// runtime imports beyond matching.ts, so Node can run the tests.

/** A failed request for a walk is tried again after this long, then twice as long, up to MAX_RETRY_MS. */
const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000

/** A walk of one asset's, as Snap to paths asks for it. */
export type AssetWalk = MatchableWalk & { asset: number }

/** What the server answers for a walk (matchWalk): its line, null when it can't be snapped, or 'unavailable': ask again later. */
export type SnapAnswer = SnappedPoint[] | null | 'unavailable'

/** The line to draw for a walk: as answered for this version of it (`current`), or the last it had, with the fixes since as recorded. */
export type SnappedLine = { points: SnappedPoint[]; current: boolean }

/** The lines to draw, by asset, then by walk id. */
export type SnappedLines = Record<number, Record<string, SnappedLine>>

/**
 * What's known of a walk: the latest answer (for which version), the latest line it had (with the
 * times of the first and last fix it was for: none for a hop between two stays), and when to try
 * again after a failure.
 */
type Entry = {
  answered?: { signature: string; line: SnappedPoint[] | null }
  had?: { fixes: { first: number; last: number } | null; line: SnappedPoint[] }
  retry?: { signature: string; at: number; wait: number }
}

/** What's known of each walk, by asset and walk id (see entryKey). */
export type SnapState = ReadonlyMap<string, Entry>

const entryKey = (walk: AssetWalk) => `${walk.asset}/${walk.id}`
const fixesOf = (walk: AssetWalk) => walk.points.filter((point) => !point.anchor)
/** The time of a walk's first and last fix; null for a hop between two stays, which has none. */
function spanOf(walk: AssetWalk): { first: number; last: number } | null {
  const fixes = fixesOf(walk)
  return fixes.length ? { first: fixes[0]!.time, last: fixes.at(-1)!.time } : null
}

/** Whether a walk has been answered as it is (a line, or none: it can't be snapped). */
export function answered(walk: AssetWalk, state: SnapState): boolean {
  return state.get(entryKey(walk))?.answered?.signature === walk.signature
}

/** The walks to ask for as of `now`: not answered as they are, and not waiting to try again; a request's worth. */
export function toAsk(walks: AssetWalk[], state: SnapState, now: number): AssetWalk[] {
  return walks
    .filter((walk) => {
      if (answered(walk, state)) return false
      const retry = state.get(entryKey(walk))?.retry
      return !(retry?.signature === walk.signature && retry.at > now)
    })
    .slice(0, MAX_WALKS_PER_REQUEST)
}

/** When the soonest walk waiting after a failure may be asked for again; null when none is. */
export function nextTry(walks: AssetWalk[], state: SnapState): number | null {
  let soonest: number | null = null
  for (const walk of walks) {
    const entry = state.get(entryKey(walk))
    if (entry?.answered?.signature === walk.signature || entry?.retry?.signature !== walk.signature) continue
    soonest = Math.min(soonest ?? Infinity, entry.retry.at)
  }
  return soonest
}

/**
 * What's known with the server's answers for these walks, as of `now`; walks no longer among `keep`
 * are forgotten. Answers are taken in the order they come, one request at a time (see
 * useSnappedWalks): a walk can get shorter (its end became a stay), so a version isn't older for
 * having fewer fixes.
 */
export function withAnswers(state: SnapState, asked: AssetWalk[], answers: SnapAnswer[], now: number, keep?: AssetWalk[]): SnapState {
  const next = new Map(state)
  asked.forEach((walk, index) => {
    const key = entryKey(walk)
    const entry: Entry = { ...next.get(key) }
    // A walk drawn along the line of the walk it was keeps that line as its own, so it doesn't go when
    // that walk is forgotten (below).
    entry.had ??= wasWalk(walk, state)
    const answer = answers[index]
    if (answer === 'unavailable' || answer === undefined) {
      const wait = entry.retry?.signature === walk.signature ? Math.min(entry.retry.wait * 2, MAX_RETRY_MS) : FIRST_RETRY_MS
      entry.retry = { signature: walk.signature, at: now + wait, wait }
    } else {
      entry.answered = { signature: walk.signature, line: answer }
      delete entry.retry
      if (answer) entry.had = { fixes: spanOf(walk), line: answer }
    }
    next.set(key, entry)
  })
  if (keep) {
    // A walk kept that's drawn along the line of the walk it was, with no line of its own yet, keeps
    // that line, so it doesn't go with that walk (asked for or not: see otherWalks).
    for (const walk of keep) {
      const key = entryKey(walk)
      const had = next.get(key)?.had ?? wasWalk(walk, state)
      if (had) next.set(key, { ...next.get(key), had })
    }
    const ids = new Set(keep.map(entryKey))
    for (const key of next.keys()) if (!ids.has(key)) next.delete(key)
  }
  return next
}

/**
 * The line to draw for each of these walks, where there is one (see SnappedLine); the rest are drawn
 * as recorded. A walk new as such, with no line of its own yet, has the line of the walk it was for
 * the time they share: its first fix changes when the stay it set off from takes in a fix or two, and a
 * walk between two stops can turn out to be pottering about between them, a hop between their dots.
 * `others`: walks not worth asking for (see otherWalks), which keep a line they had as a longer walk.
 */
export function snappedLines(walks: AssetWalk[], state: SnapState, others: AssetWalk[] = []): SnappedLines {
  const lines: SnappedLines = {}
  for (const walk of [...walks, ...others]) {
    const entry = state.get(entryKey(walk))
    const answered = entry?.answered?.signature === walk.signature ? entry.answered.line : null
    const had = entry?.had ?? wasWalk(walk, state)
    const line = answered ? { points: answered, current: true } : had ? keptLine(had, walk) : null
    if (line) (lines[walk.asset] ??= {})[walk.id] = line
  }
  return lines
}

/** The line of a walk of the asset's (another than this one) whose time overlaps this one's. */
function wasWalk(walk: AssetWalk, state: SnapState): Entry['had'] {
  // A hop's time is from the stay before to the stay after.
  const span = spanOf(walk) ?? { first: walk.points[0]!.time, last: walk.points.at(-1)!.time }
  for (const [key, entry] of state) {
    const other = entry.had?.fixes
    if (key.startsWith(`${walk.asset}/walk-`) && key !== entryKey(walk) && other && other.first <= span.last && span.first <= other.last)
      return entry.had
  }
  return undefined
}

/**
 * The line a walk had, for the time it shares with the walk as it is now (from its start, if that's
 * the same), and the walk's other fixes, before and after, as recorded; null when they share no time.
 * A hop between two stays has no fixes: its line as it was.
 */
function keptLine(had: NonNullable<Entry['had']>, walk: AssetWalk): SnappedLine | null {
  const span = spanOf(walk)
  // A hop: the line it had, or the walk it was.
  if (!span) return { points: had.line, current: false }
  if (!had.fixes) return null
  const sameStart = had.fixes.first === span.first
  const [from, to] = [sameStart ? -Infinity : Math.max(had.fixes.first, span.first), Math.min(had.fixes.last, span.last)]
  const kept = had.line.filter((point) => point.time >= from && point.time <= to)
  if (kept.length === 0) return null
  const recorded = (points: MatchablePoint[]) => points.map(({ lat, lon, time }) => ({ lat, lon, time, how: 'recorded' as const }))
  const fixes = fixesOf(walk)
  return {
    points: [...recorded(fixes.filter((point) => point.time < from)), ...kept, ...recorded(fixes.filter((point) => point.time > to))],
    current: false,
  }
}
