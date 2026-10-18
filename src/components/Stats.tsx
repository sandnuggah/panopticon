import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Segmented, SegmentedButton } from 'konsta/react'
import type { Asset } from '../lib/asset'
import { durationLabel, type Place } from '../lib/places'
import type { LatLon } from '../lib/segments'
import { addUp, lastDays, periodDays, previousDays, streak, type Day, type DayStats, type Period } from '../lib/stats'
import { getDayStats } from '../server/stats.functions'
import { Backdrop, CARD_BG, CloseButton, moveFocus, pageCardClass } from './cards'
import { StatsIcon } from './icons'

/** How far back the walk streak looks. */
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
  const [streakDays, setStreakDays] = useState<{ key: string; days: DayStats[] }>()
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
      .then((stats) => current && setStreakDays({ key: String(asset.id), days: stats }))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [open, key])

  const shown = loaded?.key === key ? loaded : undefined
  const walkStreak = streakDays?.key === String(asset.id) ? streak(streakDays.days) : undefined

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
}

function Numbers({ name, period, days, stats, before, home, walkStreak }: NumbersProps) {
  const total = addUp(stats)
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
      </dl>
      <p className="mt-4 text-sm opacity-60">
        Walks are {name}'s moves between stays that got at least 75 m away; rides aren't counted. Stops are pauses of a minute or more on a
        walk: sniffing, peeing, saying hello. The streak counts days in a row with at least 500 m of walks, over the last 90 days.
      </p>
    </>
  )
}

/** A bar per day: this week's seven (the days to come empty), or the month's days so far. */
function Bars({ period, days, stats }: { period: Period; days: Day[]; stats: DayStats[] }) {
  const slots = period === 'week' ? 7 : days.length
  const most = Math.max(1, ...stats.map((day) => day.walked))
  const label = (index: number) => {
    if (period === 'week') return ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]
    const date = days[index] ? new Date(days[index]!.from).getDate() : 0
    return date === 1 || date % 7 === 0 ? String(date) : ''
  }
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

/** "850 m", "21.4 km". */
function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`
  return `${(metres / 1000).toLocaleString('en', { maximumFractionDigits: 1, minimumFractionDigits: metres < 100_000 ? 1 : 0 })} km`
}

function daysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}
