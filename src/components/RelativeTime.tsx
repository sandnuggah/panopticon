import { useEffect, useState } from 'react'

const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
]

/** "4 minutes ago", re-rendered every 30 s. Falls back to "just now" under a minute. */
export function RelativeTime({ time }: { time: string }) {
  const now = useNow(30_000)
  const date = new Date(time)
  const seconds = Math.round((date.getTime() - now) / 1000)
  return (
    // Server and browser clocks differ, so the first client render may not match the server's text.
    <time dateTime={time} title={date.toLocaleString()} suppressHydrationWarning>
      {describe(seconds)}
    </time>
  )
}

function describe(seconds: number): string {
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit)
  }
  return 'just now'
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
