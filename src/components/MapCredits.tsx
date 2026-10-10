import type { ReactNode } from 'react'

/**
 * The map data's credits (OpenFreeMap, OpenMapTiles, OpenStreetMap), which the licence requires, in
 * small print: in the Settings card on the map screen, in the panel on live link pages. The map
 * reads them from its style's sources (see AssetMap's onAttribution).
 */
export function MapCredits({ credits, className = '' }: { credits: string[]; className?: string }) {
  if (credits.length === 0) return null
  return (
    <p className={`text-center text-xs opacity-60 ${className}`}>
      {credits.map((html, index) => (
        <span key={html}>
          {index > 0 && ' · '}
          {creditParts(html)}
        </span>
      ))}
    </p>
  )
}

/**
 * A map source's credit as text and links. It's HTML from the map style, so it isn't inserted as
 * HTML: only its text, and its links when they're http(s), as new-tab links.
 */
function creditParts(html: string): ReactNode[] {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return [...body.childNodes].map((node, index) =>
    node instanceof HTMLAnchorElement && /^https?:/.test(node.href) ? (
      <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="underline">
        {node.textContent}
      </a>
    ) : (
      node.textContent
    ),
  )
}
