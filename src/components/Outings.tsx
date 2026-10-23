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
 * The asset's outings today, as Stats counts them and the map draws them: when, for how long, how
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
          {outings.map((outing) => (
            <li key={outing.from} className="flex items-center gap-x-2.5 py-0.5">
              <span className="shrink-0 text-primary">
                <OutIcon />
              </span>
              <span className="min-w-0 flex-1">
                {clock.format(outing.from)}–{outing.to === null ? 'now' : clock.format(outing.to)} ·{' '}
                {durationLabel((outing.to ?? now) - outing.from)} · {walkedOuting(outing) ? distanceLabel(outing.walked) : 'a ride'}
              </span>
              <span className="shrink-0 opacity-60">up to {distanceLabel(outing.furthest)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
