import { Fragment } from 'react'
import { parseCredit } from '../lib/credits'

/**
 * The map data's credits (OpenFreeMap, OpenMapTiles, OpenStreetMap), which the licence requires, in
 * small print: in the Settings card on the map screen, in the panel on live link pages. The map
 * reads them from its style's sources (see AssetMap's onAttribution); they're HTML, shown only as
 * text and http(s) links (see credits.ts).
 */
export function MapCredits({ credits, className = '' }: { credits: string[]; className?: string }) {
  if (credits.length === 0) return null
  return (
    <p className={`text-center text-xs opacity-60 ${className}`}>
      {credits.map((html, index) => (
        <span key={html}>
          {index > 0 && ' · '}
          {parseCredit(html).map((part, partIndex) => (
            <Fragment key={partIndex}>
              {partIndex > 0 && ' '}
              {part.href ? (
                <a href={part.href} target="_blank" rel="noopener noreferrer" className="underline">
                  {part.text}
                </a>
              ) : (
                part.text
              )}
            </Fragment>
          ))}
        </span>
      ))}
    </p>
  )
}
