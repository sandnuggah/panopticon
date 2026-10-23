import { distanceLabel, walkedOuting, type Outing } from '../lib/outings'
import { durationLabel } from '../lib/places'
import { OutIcon } from './icons'

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

type Props = {
  /** Today's outings (see outings.ts), oldest first. */
  outings: Outing[]
  now: number
}

/**
 * The asset's outings today, newest first, as Stats counts them and the map draws them: when, for how long, how
 * far it walked and how far it got. "17:03–17:13 · 10 min · 400 m, up to 100 m". Screen readers hear
 * the same. Until October 2026 the card listed Traccar's raw arrivals and departures instead, which
 * flapped along Home's edge (115 in a week for about 30 real comings and goings).
 */
export function Outings({ outings, now }: Props) {
  return (
    <section className="pt-4" aria-label="Today's outings">
      <h3 className="pb-1 text-sm font-semibold opacity-60">Today's outings</h3>
      {outings.length === 0 ? (
        <p className="opacity-60">None yet today.</p>
      ) : (
        <ul>
          {outings.toReversed().map((outing) => (
            <li key={outing.from} className="flex items-start gap-x-2.5 py-1">
              {/* On the first line, however many the text takes. */}
              <span className="flex h-lh shrink-0 items-center text-primary">
                <OutIcon />
              </span>
              {/* Its parts kept whole; "up to" on a line of its own when they don't fit (large text sizes). */}
              <span className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-2.5">
                <span className="min-w-0">
                  <span className="whitespace-nowrap">{clock.format(outing.from)}–</span>
                  <span className="whitespace-nowrap">{outing.to === null ? 'now' : clock.format(outing.to)}</span> ·{' '}
                  <span className="whitespace-nowrap">{durationLabel((outing.to ?? now) - outing.from)}</span> ·{' '}
                  <span className="whitespace-nowrap">{walkedOuting(outing) ? distanceLabel(outing.walked) : 'a ride'}</span>
                </span>
                <span className="whitespace-nowrap opacity-60">up to {distanceLabel(outing.furthest)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
