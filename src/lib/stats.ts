import { outingsOf, walkedOuting, walkLength } from './outings.ts'
import { classifyTrail, DEFAULT_TRAIL_PROFILE, distance, type LatLon, type PlaceStay, type TrailProfile } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Stats for an asset (the Stats card): its outings day by day, the same ones as on its card and the
// map (outings.ts), worked out with the map's own rules (segments.ts) from its Traccar history.
// Nothing leaves the user's own servers. No runtime imports beyond segments.ts and outings.ts, so
// Node can run the tests directly.
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
 * One day's outings (`walks`, as the card calls them) and the walking on them. Distances in metres,
 * times in ms; `furthest` is from Home, null without one. `fixes`: how many GPS fixes the day had,
 * so a day the tracker wasn't there for shows as such.
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
 * The outings in one day's points (see outingsOf), with the asset's visits to its places (`visits`,
 * see placeStays in presence.ts): how many walked that left that day, how far they walked (the longest, one outing's), how long
 * they were out, the stops on the way, and how far from Home they got.
 */
export function dayStats(
  points: TrailPoint[],
  home: LatLon | null,
  profile: TrailProfile = DEFAULT_TRAIL_PROFILE,
  visits: PlaceStay[] = [],
  day?: Day,
): DayStats {
  // With `day`, the points go some hours either side of it, so what's around midnight is seen whole
  // (a stay from 23:45 to 00:15 is as long as it was): an outing counts on the day it left, and its
  // walking on each day it walked.
  const inDay = (time: number) => !day || (time >= day.from && time < day.to)
  const stats = { ...NO_WALKS, fixes: points.filter((point) => point.valid && inDay(point.time)).length }
  const last = points.at(-1)?.time ?? 0
  for (const outing of outingsOf(classifyTrail(points, { visits, profile }))) {
    // A drive to daycare is no walk, nor time out walking.
    if (!walkedOuting(outing)) continue
    const walks = outing.walks.map((walk) => walk.filter((fix) => inDay(fix.time))).filter((walk) => walk.length > 0)
    const fixes = walks.flat()
    // Counted on the day it left (not again after midnight).
    if (day ? inDay(outing.from) : outing.began) stats.walks++
    const walked = walks.reduce((sum, walk) => sum + walkLength(walk), 0)
    stats.walked += walked
    stats.longest = Math.max(stats.longest, day && !inDay(outing.from) ? 0 : outing.walked)
    const [from, to] = [Math.max(outing.from, day?.from ?? -Infinity), Math.min(outing.to ?? last, day?.to ?? Infinity)]
    stats.walking += Math.max(0, to - from)
    stats.stops += walks.reduce((sum, walk) => sum + countStops(walk), 0)
    if (home && fixes.length > 0) stats.furthest = Math.max(stats.furthest ?? 0, ...fixes.map((fix) => distance(home, fix)))
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
