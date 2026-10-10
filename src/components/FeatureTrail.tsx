import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type Feature = { title: string; text: string; color: string; icon: ReactNode }

/**
 * The front page's features as stops on a trail: each a paper-cutout badge (white edge, hard
 * shadow, like the scene's cutouts) with its title and text beside it on a post-it note, alternating
 * left and right,
 * joined by a dotted path that winds from badge to badge, between the stops rather than through
 * their text, and marches like the scene's trails. It's drawn from where the badges and stops end
 * up, so it follows the text whatever its length or size.
 */
export function FeatureTrail({ features }: { features: Feature[] }) {
  const container = useRef<HTMLOListElement>(null)
  const stopsRef = useRef<{ row: HTMLLIElement | null; badge: HTMLSpanElement | null }[]>([])
  const [trail, setTrail] = useState<{ d: string; width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const draw = () => {
      const box = element.getBoundingClientRect()
      const stops = stopsRef.current.flatMap(({ row, badge }) => {
        if (!row || !badge) return []
        const rowRect = row.getBoundingClientRect()
        const badgeRect = badge.getBoundingClientRect()
        return [
          {
            x: badgeRect.left + badgeRect.width / 2 - box.left,
            y: badgeRect.top + badgeRect.height / 2 - box.top,
            top: rowRect.top - box.top,
            bottom: rowRect.bottom - box.top,
          },
        ]
      })
      // From each badge straight down past its text, across in the gap between stops with rounded
      // corners, and down into the next badge: the dots never run through the text.
      let d = ''
      stops.forEach((stop, index) => {
        if (index === 0) return void (d = `M${stop.x} ${stop.y}`)
        const previous = stops[index - 1]!
        const across = (previous.bottom + stop.top) / 2
        const turn = Math.min(14, Math.abs(stop.x - previous.x) / 2, (stop.top - previous.bottom) / 2)
        const toward = Math.sign(stop.x - previous.x)
        d +=
          ` V${across - turn} Q${previous.x} ${across} ${previous.x + toward * turn} ${across}` +
          ` H${stop.x - toward * turn} Q${stop.x} ${across} ${stop.x} ${across + turn} V${stop.y}`
      })
      setTrail({ d, width: box.width, height: box.height })
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    return () => observer.disconnect()
  }, [features.length])

  return (
    <ol ref={container} className="relative mx-4 flex flex-col gap-14 py-2">
      {trail && (
        <svg className="feature-trail pointer-events-none absolute inset-0" width={trail.width} height={trail.height} aria-hidden="true">
          <path d={trail.d} className="feature-trail-path" />
        </svg>
      )}
      {features.map((feature, index) => {
        const right = index % 2 === 1
        return (
          <li
            key={feature.title}
            ref={(row) => {
              stopsRef.current[index] = { ...stopsRef.current[index], row, badge: stopsRef.current[index]?.badge ?? null }
            }}
            className={`relative flex items-center gap-4 ${right ? 'flex-row-reverse text-right' : ''}`}
          >
            <span
              ref={(badge) => {
                stopsRef.current[index] = { row: stopsRef.current[index]?.row ?? null, badge }
              }}
              className={`feature-stop grid size-14 shrink-0 place-items-center rounded-full text-white [&>svg]:size-7 ${feature.color} ${right ? 'rotate-6' : '-rotate-6'}`}
            >
              {feature.icon}
            </span>
            <div className={`feature-note min-w-0 flex-1 text-left lg:max-w-md ${right ? '-rotate-1' : 'rotate-1'}`}>
              <h3 className="text-[1.0625rem] font-semibold">{feature.title}</h3>
              <p className="text-[0.9375rem] opacity-75">{feature.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
