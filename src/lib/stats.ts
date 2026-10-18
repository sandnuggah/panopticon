import { classifyTrail, distance, type LatLon } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Stats for an asset (the Stats card): its walks day by day, worked out with the map's own rules
// (segments.ts), from its Traccar history. Nothing leaves the user's own servers. No runtime imports
// beyond segments.ts, so Node can run the tests directly.

/** A walk must get at least this far from where it started, as for Snap to paths (matching.ts). */
const MIN_WALK_METERS = 75
/** Points closer than this to the previous kept one are jitter, left out of a walk's length. */
const JITTER_METERS = 15
/**
 * A stop on a walk: fixes for at least this long within this distance of the first of them. A
 * 20-second pee between two fixes 30 s apart leaves no trace; sniffing, peeing and saying hello for
 * a minute or so does.
 */
const STOP_MIN_MS = 60 * 1000
const STOP_METERS = 20
/** A day counts towards the walk streak with walks of at least this far in all. */
export const STREAK_MIN_METERS = 500

/**
 * One day's walks. Distances in metres, times in ms; `furthest` is from Home, null without one.
 * `fixes`: how many GPS fixes the day had, so a day the tracker wasn't there for shows as such.
 */
export type DayStats = {
  walked: number
  walks: number
  longest: number
  walking: number
  stops: number
  furthest: number | null
  fixes: number
}

export const NO_WALKS: DayStats = { walked: 0, walks: 0, longest: 0, walking: 0, stops: 0, furthest: null, fixes: 0 }

/** A local day, from its midnight to the next (ms since epoch). */
export type Day = { from: number; to: number }

export type Period = 'today' | 'week' | 'month'

/**
 * The walks in one day's points: moves between stays (as the map draws them, short stops part of
 * the walk) that get at least 75 m from where they started, without rides.
 */
export function dayStats(points: TrailPoint[], home: LatLon | null): DayStats {
  const stats = { ...NO_WALKS, fixes: points.filter((point) => point.valid).length }
  for (const piece of classifyTrail(points, { showWandering: true })) {
    if (piece.kind !== 'move') continue
    const fixes = piece.points
    if (!fixes.some((fix) => distance(fixes[0]!, fix) >= MIN_WALK_METERS)) continue
    const length = walkLength(fixes)
    stats.walks++
    stats.walked += length
    stats.longest = Math.max(stats.longest, length)
    stats.walking += fixes.at(-1)!.time - fixes[0]!.time
    stats.stops += countStops(fixes)
    if (home) stats.furthest = Math.max(stats.furthest ?? 0, ...fixes.map((fix) => distance(home, fix)))
  }
  return stats
}

/** Days added up: totals, and the longest walk and furthest point of any of them. */
export function addUp(days: DayStats[]): DayStats {
  return days.reduce(
    (sum, day) => ({
      walked: sum.walked + day.walked,
      walks: sum.walks + day.walks,
      longest: Math.max(sum.longest, day.longest),
      walking: sum.walking + day.walking,
      stops: sum.stops + day.stops,
      furthest: day.furthest === null ? sum.furthest : Math.max(sum.furthest ?? 0, day.furthest),
      fixes: sum.fixes + day.fixes,
    }),
    NO_WALKS,
  )
}

/**
 * Days in a row with at least STREAK_MIN_METERS of walks, from days oldest first ending today: the
 * current streak (today counts once it's walked, and doesn't break it before then) and the longest.
 */
export function streak(days: DayStats[]): { current: number; longest: number } {
  const walked = days.map((day) => day.walked >= STREAK_MIN_METERS)
  let longest = 0
  let run = 0
  for (const day of walked) {
    run = day ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  let current = 0
  for (let i = walked.length - (walked.at(-1) ? 1 : 2); i >= 0 && walked[i]; i--) current++
  return { current, longest }
}

/** The local days of a period up to today, oldest first: today, this week from Monday, this month. */
export function periodDays(period: Period, now: number): Day[] {
  const today = startOfDay(now)
  const first = new Date(today)
  if (period === 'week') first.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  if (period === 'month') first.setDate(1)
  return daysBetween(first, today)
}

/** The same stretch of the period before (last week, last month, yesterday), for comparing: as many days as `days`, or the whole month before when that's shorter. */
export function previousDays(period: Period, days: Day[]): Day[] {
  const first = new Date(days[0]!.from)
  if (period === 'today') first.setDate(first.getDate() - 1)
  if (period === 'week') first.setDate(first.getDate() - 7)
  if (period === 'month') first.setMonth(first.getMonth() - 1)
  const last = new Date(first)
  last.setDate(last.getDate() + days.length - 1)
  // Up to the 31st of a shorter month: up to its end.
  const before = new Date(days[0]!.from)
  before.setDate(before.getDate() - 1)
  return daysBetween(first, last > before ? before : last)
}

/** The last `count` local days, oldest first, ending today. */
export function lastDays(count: number, now: number): Day[] {
  const today = startOfDay(now)
  const first = new Date(today)
  first.setDate(first.getDate() - (count - 1))
  return daysBetween(first, today)
}

function daysBetween(first: Date, last: Date): Day[] {
  const days: Day[] = []
  for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    days.push({ from: day.getTime(), to: next.getTime() })
  }
  return days
}

function startOfDay(time: number): Date {
  const day = new Date(time)
  day.setHours(0, 0, 0, 0)
  return day
}

function walkLength(fixes: TrailPoint[]): number {
  let length = 0
  let kept = fixes[0]!
  for (const fix of fixes.slice(1)) {
    const step = distance(kept, fix)
    if (step < JITTER_METERS && fix !== fixes.at(-1)) continue
    length += step
    kept = fix
  }
  return length
}

function countStops(fixes: TrailPoint[]): number {
  let stops = 0
  let i = 0
  while (i < fixes.length) {
    let j = i
    while (j + 1 < fixes.length && distance(fixes[i]!, fixes[j + 1]!) <= STOP_METERS) j++
    if (fixes[j]!.time - fixes[i]!.time >= STOP_MIN_MS) {
      stops++
      i = j + 1
    } else i++
  }
  return stops
}
