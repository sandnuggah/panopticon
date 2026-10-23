import type { AlertRule } from './alerts.ts'
import { outingsOf, walkedOuting } from './outings.ts'
import type { Place } from './places.ts'
import { placeStays, placeVisits } from './presence.ts'
import { classifyTrail, type TrailProfile } from './segments.ts'
import type { TrailPoint } from './trail.ts'

// Walk reminders ("puppy mode"): a push alert when a dog at home hasn't been out for a while, by
// the outings the card and Stats count (outings.ts). The server checks every few minutes
// (walkReminder.server.ts); this is the deciding, so Node can run the tests directly.

/** After how long since the last walk a reminder can be asked for, in minutes. */
export const WALK_AFTER_MINUTES = [60, 90, 120, 180, 240] as const

/** A new reminder: after two hours, quiet from 22 to 7. */
export const DEFAULT_WALK_RULE: AlertRule = 'walk:120:22-7'

/** A walk reminder's settings: after how many minutes, and its quiet hours (local, from and until; the same is none). */
export type WalkRule = { minutes: number; quietFrom: number; quietUntil: number }

export function parseWalkRule(rule: AlertRule): WalkRule | null {
  const match = /^walk:(\d+):(\d+)-(\d+)$/.exec(rule)
  return match ? { minutes: Number(match[1]), quietFrom: Number(match[2]), quietUntil: Number(match[3]) } : null
}

export function walkRule({ minutes, quietFrom, quietUntil }: WalkRule): AlertRule {
  return `walk:${minutes}:${quietFrom}-${quietUntil}`
}

/** A phone's walk reminder for an asset, among its rules. */
export function walkRuleOf(rules: AlertRule[]): AlertRule | undefined {
  return rules.find((rule) => rule.startsWith('walk:'))
}

/** Whether a time is in the quiet hours, in the phone's time zone (UTC if it's unknown). */
export function inQuietHours(time: number, rule: WalkRule, timeZone: string): boolean {
  const { quietFrom: from, quietUntil: until } = rule
  if (from === until) return false
  const hour = localHour(time, timeZone)
  return from < until ? hour >= from && hour < until : hour >= from || hour < until
}

/** The last walk, as its outing: when it got back, how long it was out and how far it walked. */
export type LastWalk = { end: number; ms: number; meters: number }

/**
 * Where a dog stands for its reminder, from its recent points: at home (at its Home place, or with
 * none, not out), and its last walk, if one is in the points.
 */
export function walkState(
  points: TrailPoint[],
  places: Place[],
  assetId: number,
  profile: TrailProfile,
  now: number,
): { atHome: boolean; last: LastWalk | null } {
  const own = places.filter((place) => place.assetIds.includes(assetId))
  const pieces = classifyTrail(points, { visits: placeStays(points, own, assetId, profile, now), profile })
  const outings = outingsOf(pieces, now)
  const out = outings.at(-1)?.to === null
  const home = homePlace(own)
  const visit = home ? placeVisits(points, [home], assetId, profile, now).at(-1) : undefined
  const atHome = home ? visit !== undefined && visit.to === null : !out
  const walk = outings.findLast((outing) => outing.to !== null && walkedOuting(outing))
  return { atHome, last: walk ? { end: walk.to!, ms: walk.to! - walk.from, meters: walk.walked } : null }
}

/** The asset's Home: its place called Home, or else its first place, as Stats has it. */
export function homePlace(own: Place[]): Place | undefined {
  return own.find((place) => place.name.trim().toLowerCase() === 'home') ?? own[0]
}

/**
 * Whether to remind now: at home, the time since its last walk ended (or, with none in the points,
 * since they start) is up, it isn't quiet hours, and this wait hasn't been reminded of yet
 * (`reminded`: the wait last reminded of, by when it began).
 */
export function walkReminderDue(state: {
  atHome: boolean
  since: number
  now: number
  rule: WalkRule
  timeZone: string
  reminded: number | undefined
}): boolean {
  const { atHome, since, now, rule, timeZone, reminded } = state
  if (!atHome || reminded === since) return false
  return now - since >= rule.minutes * 60_000 && !inQuietHours(now, rule, timeZone)
}

/**
 * The reminder: "Kofi hasn't been out for 2 hours", or when it's later than that (it waited through
 * quiet hours), "since 21:30"; and the last walk, if known: "Last walk ended at 14:02 (35 min, 1.8 km)".
 */
export function walkReminderText(
  name: string,
  last: LastWalk | null,
  since: number,
  now: number,
  rule: WalkRule,
  timeZone: string,
  locale: string,
): { title: string; body: string } {
  const time = clock(timeZone, locale)
  const late = now - since > rule.minutes * 60_000 + 15 * 60_000
  if (!last) return { title: `${name} hasn't been out for a while`, body: `No walk since ${time(since)}` }
  const title = late ? `${name} hasn't been out since ${time(last.end)}` : `${name} hasn't been out for ${hoursLabel(rule.minutes)}`
  const minutes = Math.max(1, Math.round(last.ms / 60_000))
  const km = (last.meters / 1000).toLocaleString('en', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
  return { title, body: `Last walk ended at ${time(last.end)} (${minutes} min, ${km} km)` }
}

/** "1 hour", "1½ hours", "2 hours". */
export function hoursLabel(minutes: number): string {
  const hours = minutes / 60
  const whole = Math.floor(hours)
  const text = hours === whole ? String(whole) : `${whole === 0 ? '' : whole}½`
  return hours === 1 ? '1 hour' : `${text} hours`
}

function clock(timeZone: string, locale: string): (time: number) => string {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  }
  return (time) => format.format(new Date(time))
}

function localHour(time: number, timeZone: string): number {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'UTC' })
  }
  return Number(format.format(new Date(time))) % 24
}
