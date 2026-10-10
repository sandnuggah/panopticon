import type { CSSProperties, ReactNode } from 'react'

// The front page's picture: a folded paper map with a dog, a briefcase and a bike on it as paper
// cutouts, a little like Paper Mario or Yoshi's Island. A handful of RAL colours (approximate
// sRGB): 8003 clay brown, 1023 traffic yellow, 3020 traffic red, 1015 light ivory, 9016 traffic
// white, 7016 anthracite grey; the map's own colours come from styles.css (--scene-*), a day map
// in light mode and a night map in dark mode. The cutouts bob, the trails march and the clouds
// drift, none of it with Reduce Motion. Decorative: hidden from screen readers.

const CLAY = '#7E4B26' // RAL 8003
const YELLOW = '#F0CA00' // RAL 1023
const RED = '#CC0605' // RAL 3020
const IVORY = '#EADEBD' // RAL 1015
const WHITE = '#F6F6F6' // RAL 9016
const INK = '#293133' // RAL 7016

/**
 * One part of a cutout. The cutout is drawn twice: first as its white paper backing with a hard
 * shadow (the wrapper sets --paper and --edge), then in colour; the custom properties fall back
 * to the part's own colours.
 */
function part(fill: string, stroke = INK, width = 2.5): CSSProperties {
  return {
    fill: `var(--paper, ${fill})`,
    stroke: `var(--edge, ${stroke})`,
    strokeWidth: `var(--edge-width, ${width})`,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  }
}

const BACKING = { '--paper': WHITE, '--edge': WHITE, '--edge-width': 11 } as CSSProperties

/** A paper cutout standing on the map at (x, y), bobbing, with its shadow on the paper below. */
function Cutout({ x, y, delay, children }: { x: number; y: number; delay: string; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="22" rx="20" ry="4.5" className="scene-ground-shadow" />
      <g className="scene-bob" style={{ animationDelay: delay }}>
        <g style={BACKING} filter="url(#scene-paper-shadow)">
          {children}
        </g>
        {children}
      </g>
    </g>
  )
}

function Dog() {
  return (
    <>
      <path d="M-20 -2 q -15 -5 -11 -21 q 5 2 4 7 q -2 7 9 9z" style={part(CLAY)} />
      <rect x="-12" y="4" width="6" height="15" rx="3" style={part(CLAY)} />
      <rect x="8" y="4" width="6" height="15" rx="3" style={part(CLAY)} />
      <rect x="-23" y="-11" width="40" height="20" rx="10" style={part(CLAY)} />
      <rect x="-17" y="4" width="6" height="15" rx="3" style={part(CLAY)} />
      <rect x="3" y="4" width="6" height="15" rx="3" style={part(CLAY)} />
      <rect x="9" y="-8" width="5" height="11" rx="1.5" style={part(RED)} />
      <circle cx="21" cy="-14" r="12" style={part(CLAY)} />
      <ellipse cx="31" cy="-10" rx="8" ry="6" style={part(IVORY)} />
      <path d="M15 -24 q -10 3 -8 16 q 7 -3 10 -14z" style={part(INK)} />
      <circle cx="37" cy="-12" r="2.8" style={part(INK, INK, 0)} />
      <circle cx="24" cy="-17" r="2.2" style={part(INK, INK, 0)} />
    </>
  )
}

function Briefcase() {
  return (
    <>
      <path d="M-10 -14 v-7 q0-5 5-5 h10 q5 0 5 5 v7 h-4.5 v-6 q0-1.5-1.5-1.5 h-8 q-1.5 0-1.5 1.5 v6z" style={part(INK)} />
      <rect x="-25" y="-15" width="50" height="35" rx="6" style={part(YELLOW)} />
      <rect x="-25" y="-3" width="50" height="5" style={part(INK, INK, 0)} />
      <rect x="-5" y="-6" width="10" height="10" rx="2" style={part(IVORY)} />
    </>
  )
}

function Bike() {
  return (
    <>
      <circle cx="-17" cy="8" r="12" style={part('none', INK, 4.5)} />
      <circle cx="18" cy="8" r="12" style={part('none', INK, 4.5)} />
      <path d="M-17 8 L-3 -10 L13 -10 L18 8 M-3 -10 L2 8 L-17 8 M2 8 L13 -10" style={part('none', RED, 4.5)} />
      <path d="M11 -14 l4 -7 h6" style={part('none', INK, 4)} />
      <path d="M-10 -14 h9" style={part('none', INK, 5)} />
      <circle cx="2" cy="8" r="3" style={part(INK, INK, 0)} />
    </>
  )
}

/** A paper cloud: its puffs outlined as one shape (an ink layer under a white one), drifting. */
function Cloud({ x, y, delay }: { x: number; y: number; delay: string }) {
  const puffs = (style: CSSProperties) => (
    <>
      <circle cx="-13" cy="2" r="9" style={style} />
      <circle cx="13" cy="2" r="9" style={style} />
      <circle cx="0" cy="-3" r="13" style={style} />
      <rect x="-13" y="2" width="26" height="9" style={style} />
    </>
  )
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="scene-cloud" style={{ animationDelay: delay }}>
        <g filter="url(#scene-paper-shadow)">{puffs({ fill: WHITE, stroke: WHITE, strokeWidth: 11 })}</g>
        {puffs({ fill: INK, stroke: INK, strokeWidth: 5 })}
        {puffs({ fill: WHITE })}
      </g>
    </g>
  )
}

const MAP = '28,34 374,22 382,214 20,226'

export function WelcomeScene() {
  return (
    <svg className="scene" viewBox="0 0 400 240" aria-hidden="true">
      <defs>
        <filter id="scene-paper-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="2.5" dy="3.5" stdDeviation="0" floodColor="#000" floodOpacity="0.28" />
        </filter>
        <clipPath id="scene-map">
          <polygon points={MAP} />
        </clipPath>
      </defs>

      {/* The map: a sheet of paper folded in three, with its shadow. */}
      <polygon points={MAP} transform="translate(6 8)" className="scene-map-shadow" />
      <polygon points={MAP} className="scene-map" />
      <g clipPath="url(#scene-map)">
        <polygon points="142,26 262,22 266,216 140,221" className="scene-map-fold" />
        <path d="M40 46 q 40 -18 86 -4 q 28 12 12 40 q -22 26 -70 18 q -40 -10 -28 -54z" className="scene-park" />
        <path d="M10 178 C 80 150, 120 210, 196 178 S 310 128, 392 150" className="scene-river" />
        <path d="M10 178 C 80 150, 120 210, 196 178 S 310 128, 392 150" className="scene-river-shine" />
        {['M10 112 C 120 98, 240 132, 392 92', 'M214 14 C 204 86, 250 150, 234 230'].map((d) => (
          <g key={d}>
            <path d={d} className="scene-road-edge" />
            <path d={d} className="scene-road" />
          </g>
        ))}
        <path d="M36 74 C 50 104, 66 120, 92 146" className="scene-trail" />
        <path d="M236 52 C 256 66, 270 78, 296 80" className="scene-trail" />
        <path d="M200 206 C 232 192, 258 204, 290 184" className="scene-trail" />
      </g>
      <polygon points={MAP} className="scene-map-edge" />

      <Cloud x={84} y={22} delay="0s" />
      <Cloud x={330} y={14} delay="-4s" />

      <Cutout x={104} y={140} delay="0s">
        <Dog />
      </Cutout>
      <Cutout x={312} y={72} delay="-0.8s">
        <Briefcase />
      </Cutout>
      <Cutout x={306} y={172} delay="-1.6s">
        <Bike />
      </Cutout>
    </svg>
  )
}
