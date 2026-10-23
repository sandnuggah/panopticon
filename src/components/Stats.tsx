import { useEffect, useRef, useState } from 'react'
import { distanceLabel } from '../lib/outings'
import { createPortal } from 'react-dom'
import { Button, Segmented, SegmentedButton } from 'konsta/react'
import type { Asset } from '../lib/asset'
import { durationLabel, type Place } from '../lib/places'
import type { LatLon } from '../lib/segments'
import {
  addUp,
  averageWalk,
  byWeekday,
  daysPerCharge,
  lastDays,
  periodDays,
  previousDays,
  records,
  streak,
  walkTimes,
  type Day,
  type DayStats,
  type Period,
} from '../lib/stats'
import { getDayStats } from '../server/stats.functions'
import { Backdrop, CARD_BG, CloseButton, moveFocus, pageCardClass } from './cards'
import { StatsIcon } from './icons'

/** How far back the walk streak, the records, the days of the week and the time per charge look. */
const STREAK_DAYS = 90

type Props = {
  asset: Asset
  /** The user's places: "furthest from Home" is from the asset's Home. */
  places: Place[]
  /** False once the card holding Stats has closed, which closes the Stats card too. */
  active: boolean
}

/**
 * Stats, a button on the details card, and the Stats card it opens over the screen (like Share): the
 * asset's walks today, this week or this month, worked out on the server from its Traccar history.
 */
export function Stats({ asset, places, active }: Props) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const [host, setHost] = useState<Element | null>(null)
  useEffect(() => setHost(document.querySelector('.app')), [])
  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])

  return (
    <>
      <Button ref={button} rounded outline onClick={() => setOpen(true)}>
        <StatsIcon />
        Stats
      </Button>
      {host &&
        createPortal(
          <StatsCard
            asset={asset}
            home={homeOf(asset, places)}
            open={open}
            onClose={() => {
              setOpen(false)
              moveFocus(button.current)
            }}
          />,
          host,
        )}
    </>
  )
}

type Loaded = { key: string; period: DayStats[]; before: DayStats[] } | { key: string; failed: true }

function StatsCard({
  asset,
  home,
  open,
  onClose,
}: {
  asset: Asset
  home: { name: string; at: LatLon } | null
  open: boolean
  onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  const [period, setPeriod] = useState<Period>('week')
  const [loaded, setLoaded] = useState<Loaded>()
  const [streakDays, setStreakDays] = useState<{ key: string; days: DayStats[]; list: Day[] }>()
  const [days, setDays] = useState<Day[]>([])
  const homeAt = home?.at ?? null
  const key = `${asset.id}:${period}:${homeAt?.lat},${homeAt?.lon}`

  useEffect(() => {
    if (!open) return
    moveFocus(close.current)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // The period and the same stretch before it, in one request; then the streak's 90 days, most of
  // them already worked out on the server by then.
  useEffect(() => {
    if (!open) return
    let current = true
    const now = Date.now()
    const shown = periodDays(period, now)
    const before = previousDays(period, shown)
    setDays(shown)
    getDayStats({ data: { assetId: asset.id, days: [...before, ...shown], home: homeAt } })
      .then((stats) => current && setLoaded({ key, before: stats.slice(0, before.length), period: stats.slice(before.length) }))
      .catch(() => current && setLoaded({ key, failed: true }))
      .then(() => getDayStats({ data: { assetId: asset.id, days: lastDays(STREAK_DAYS, now), home: homeAt } }))
      .then((stats) => current && setStreakDays({ key: String(asset.id), days: stats, list: lastDays(STREAK_DAYS, now) }))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [open, key])

  const shown = loaded?.key === key ? loaded : undefined
  const history = streakDays?.key === String(asset.id) ? streakDays : undefined
  const walkStreak = history ? streak(history.days) : undefined

  return (
    <>
      <Backdrop shown={open} z="z-50" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-label={`${asset.name}: stats`} inert={!open} className={pageCardClass(open, 'left')}>
        <div className={`flex h-full flex-col overflow-clip rounded-t-[40px] shadow-2xl lg:rounded-[40px] ${CARD_BG}`}>
          <div className="flex shrink-0 items-center justify-between px-5 pb-1 pt-5">
            <h2 className="truncate text-[calc(0.7rem+22px)] font-bold">Stats</h2>
            <CloseButton ref={close} onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
            <Segmented strong rounded>
              {(['today', 'week', 'month'] as const).map((option) => (
                <SegmentedButton key={option} active={period === option} onClick={() => setPeriod(option)}>
                  {option === 'today' ? 'Today' : option === 'week' ? 'Week' : 'Month'}
                </SegmentedButton>
              ))}
            </Segmented>
            {!shown ? (
              <p className="flex items-center gap-2 py-8 opacity-60" role="status">
                <span className="loading-spinner size-4" aria-hidden="true" />
                Working out {asset.name}'s walks
              </p>
            ) : 'failed' in shown ? (
              <p className="py-8 opacity-60" role="status">
                Couldn't load the stats. They need Traccar's history, which reports have to be allowed for.
              </p>
            ) : (
              <Numbers
                name={asset.name}
                period={period}
                days={days}
                stats={shown.period}
                before={shown.before.every((day) => day.fixes > 0) ? addUp(shown.before) : null}
                home={home?.name ?? null}
                walkStreak={walkStreak}
                history={history}
              />
            )}
          </div>
        </div>
      </section>
    </>
  )
}

type NumbersProps = {
  name: string
  period: Period
  days: Day[]
  stats: DayStats[]
  /** The same stretch before, or null when the tracker wasn't there for all of it (a new tracker, a day off). */
  before: DayStats | null
  home: string | null
  walkStreak: { current: number; longest: number } | undefined
  /** The last 90 days, for the records, the days of the week and the time per charge; undefined until they've come. */
  history: { days: DayStats[]; list: Day[] } | undefined
}

function Numbers({ name, period, days, stats, before, home, walkStreak, history }: NumbersProps) {
  const total = addUp(stats)
  const average = averageWalk(total)
  const when = period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'
  // Against the same days of the week or month before; a day isn't over until it is, so not today.
  const change =
    period !== 'today' && before && before.walked > 0 ? Math.round(((total.walked - before.walked) / before.walked) * 100) : null
  const versus = period === 'week' ? 'this time last week' : 'this time last month'
  return (
    <>
      <p className="mt-6 text-sm opacity-60">Walked {when}</p>
      <p className="text-[2rem] leading-tight font-bold">{distanceLabel(total.walked)}</p>
      {change !== null && (
        <p className="text-sm opacity-60">
          {change === 0 ? `As much as ${versus}` : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ${versus}`}
        </p>
      )}
      {period !== 'today' && <Bars period={period} days={days} stats={stats} />}
      <dl className="mt-5 grid grid-cols-2 gap-2">
        <Tile label="Walks" value={String(total.walks)} />
        <Tile label="Longest" value={total.walks ? distanceLabel(total.longest) : '–'} />
        <Tile
          label="Average walk"
          value={average ? distanceLabel(average.meters) : '–'}
          note={average ? durationLabel(average.ms) : undefined}
        />
        <Tile label="Pace" value={average?.kmh ? `${average.kmh.toLocaleString(undefined, { maximumFractionDigits: 1 })} km/h` : '–'} />
        <Tile label="Stops on walks" value={String(total.stops)} />
        <Tile
          label="Walk streak"
          value={walkStreak ? daysLabel(walkStreak.current) : '…'}
          note={walkStreak && walkStreak.longest > walkStreak.current ? `Longest ${daysLabel(walkStreak.longest)}` : undefined}
        />
        <Tile label="Out walking" value={total.walking ? durationLabel(total.walking) : '–'} />
        {home && (
          <Tile label={`Furthest from ${home}`} value={total.furthest !== null && total.walks ? distanceLabel(total.furthest) : '–'} />
        )}
        <Tile
          label="Rides"
          value={String(total.rides)}
          note={total.rides ? `${distanceLabel(total.rode)}${total.underground ? `, ${total.underground} underground` : ''}` : undefined}
        />
      </dl>
      <WalkTimes starts={total.starts} />
      <Battery period={period} days={days} stats={stats} history={history} />
      {history && <LastDays history={history} longestStreak={walkStreak?.longest ?? 0} />}
      <p className="mt-4 text-sm opacity-60">
        Walks are {name}'s outings, as on the card: from leaving home (or another place, or anywhere it stayed 20 minutes or more) to
        getting back, at least 50 m out; rides aren't walked. Stops are pauses of a minute or more on a walk: sniffing, peeing, saying
        hello. Pace is distance over time out walking, stops included. The streak counts days in a row with at least 500 m of walks, over
        the last 90 days, as do the records and the days of the week.
      </p>
    </>
  )
}

/** A bar per day: this week's seven (the days to come empty), or the month's days so far. */
function Bars({ period, days, stats }: { period: Period; days: Day[]; stats: DayStats[] }) {
  const slots = period === 'week' ? 7 : days.length
  const most = Math.max(1, ...stats.map((day) => day.walked))
  const label = (index: number) => barLabel(period, days, index)
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="flex h-24 items-end gap-1">
        {Array.from({ length: slots }, (_, index) => (
          <div key={index} className="flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-t ${index === days.length - 1 ? 'bg-primary/50' : 'bg-primary'}`}
              style={{ height: stats[index]?.walked ? `${Math.max(2, (stats[index]!.walked / most) * 100)}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-center text-xs opacity-50">
        {Array.from({ length: slots }, (_, index) => (
          <span key={index} className="flex-1">
            {label(index)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** When walks leave, as a dot an hour across a day, and the hours they usually do. */
function WalkTimes({ starts }: { starts: number[] }) {
  if (starts.length === 0) return null
  const { hours, usual } = walkTimes(starts)
  const most = Math.max(...hours)
  const hour = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2026, 0, 1, h))
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold opacity-60">When it walks</h3>
      {usual.length > 0 && <p className="mt-1">Usually around {listed(usual.map(hour))}</p>}
      <div className="mt-3 flex h-8 items-center gap-0.5" aria-hidden="true">
        {hours.map((count, h) => (
          <div key={h} className="flex flex-1 justify-center">
            <span
              className={`rounded-full ${count ? 'bg-primary' : 'bg-black/10 dark:bg-white/15'}`}
              style={{ width: count ? 6 + (count / most) * 6 : 4, height: count ? 6 + (count / most) * 6 : 4 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex text-xs opacity-50" aria-hidden="true">
        {[0, 6, 12, 18].map((h) => (
          <span key={h} className="flex-1">
            {hour(h)}
          </span>
        ))}
      </div>
    </section>
  )
}

/** Under a bar per day: the weekday's letter, or every seventh date of a month. */
function barLabel(period: Period, days: Day[], index: number): string {
  if (period === 'week') return ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]!
  const date = days[index] ? new Date(days[index]!.from).getDate() : 0
  return date === 1 || date % 7 === 0 ? String(date) : ''
}

/** The battery: its lowest each day of the period, and how long a charge lasts over the last 90 days. */
function Battery({ period, days, stats, history }: { period: Period; days: Day[]; stats: DayStats[]; history: NumbersProps['history'] }) {
  const total = addUp(stats)
  if (!total.battery) return null
  const perCharge = history ? daysPerCharge(history.days) : null
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold opacity-60">Battery</h3>
      <p className="mt-1">
        Lowest {Math.round(total.battery.low)}%{period === 'today' ? ' today' : ''}
        {perCharge !== null && (
          <>
            {' · '}about {perCharge < 1.5 ? `${Math.max(1, Math.round(perCharge * 24))} hours` : `${Math.round(perCharge)} days`} per charge
          </>
        )}
      </p>
      {period !== 'today' && (
        <div className="mt-3" aria-hidden="true">
          <div className="flex h-12 items-end gap-1">
            {Array.from({ length: period === 'week' ? 7 : days.length }, (_, index) => {
              const low = stats[index]?.battery?.low
              return (
                <div key={index} className="flex h-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t ${low !== undefined && low <= 20 ? 'bg-[var(--offline)]' : 'bg-black/25 dark:bg-white/30'}`}
                    style={{ height: low !== undefined ? `${Math.max(4, low)}%` : 0 }}
                  />
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex gap-1 text-center text-xs opacity-50">
            {Array.from({ length: period === 'week' ? 7 : days.length }, (_, index) => (
              <span key={index} className="flex-1">
                {barLabel(period, days, index)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** The last 90 days: the records, and how far it walks on each day of the week. */
function LastDays({ history, longestStreak }: { history: NonNullable<NumbersProps['history']>; longestStreak: number }) {
  const best = records(history.days, history.list)
  const weekdays = byWeekday(history.days, history.list)
  const most = Math.max(1, ...weekdays.map((day) => day.average))
  const date = (time: number) => new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const rows: [string, string, string][] = []
  if (best.longest) rows.push(['Longest walk', distanceLabel(best.longest.meters), date(best.longest.day)])
  if (best.biggest) rows.push(['Biggest day', distanceLabel(best.biggest.meters), date(best.biggest.day)])
  if (best.earliest !== null) rows.push(['Earliest walk', clock(best.earliest), date(best.earliest)])
  if (best.latest !== null) rows.push(['Latest walk', clock(best.latest), date(best.latest)])
  if (longestStreak > 0) rows.push(['Longest streak', daysLabel(longestStreak), ''])
  if (rows.length === 0) return null
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold opacity-60">Last 90 days</h3>
      <dl className="mt-2 divide-y divide-black/10 dark:divide-white/10">
        {rows.map(([label, value, when]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt>{label}</dt>
            <dd className="text-right">
              <span className="font-semibold">{value}</span>
              {when && <span className="ml-2 text-sm opacity-60">{when}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-5 text-sm font-semibold opacity-60">Days of the week</h3>
      <p className="sr-only">
        {weekdays
          .map(
            (day, index) =>
              `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]} ${distanceLabel(day.average)}`,
          )
          .join(', ')}
      </p>
      <div className="mt-3" aria-hidden="true">
        <div className="flex h-16 items-end gap-2">
          {weekdays.map((day, index) => (
            <div key={index} className="flex h-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-primary"
                style={{ height: day.average ? `${Math.max(3, (day.average / most) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2 text-center text-xs opacity-50">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, index) => (
            <span key={index} className="flex-1">
              {letter}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/** "7", "7 and 12", "7, 12 and 18". */
function listed(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-ios-light-surface-1 px-3 py-2.5 dark:bg-[#2c2c2e]">
      <dt className="text-sm opacity-60">{label}</dt>
      <dd className="text-xl font-semibold">{value}</dd>
      {note && <dd className="text-sm opacity-60">{note}</dd>}
    </div>
  )
}

/** Where the asset's Home is: its place called Home, or else the first place it's linked to. */
function homeOf(asset: Asset, places: Place[]): { name: string; at: LatLon } | null {
  const own = places.filter((place) => place.assetIds.includes(asset.id))
  const place = own.find((candidate) => candidate.name.trim().toLowerCase() === 'home') ?? own[0]
  if (!place) return null
  const { area } = place
  if (area.kind === 'circle') return { name: place.name, at: area.center }
  const lat = area.ring.reduce((sum, point) => sum + point.lat, 0) / area.ring.length
  const lon = area.ring.reduce((sum, point) => sum + point.lon, 0) / area.ring.length
  return { name: place.name, at: { lat, lon } }
}

function daysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}
