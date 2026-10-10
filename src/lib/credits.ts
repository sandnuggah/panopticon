// The map data's credits come as HTML from the map style's sources (see AssetMap's onAttribution),
// for example `<a href="https://openfreemap.org">OpenFreeMap</a> Data from <a …>OpenStreetMap</a>`.
// They're never inserted as HTML: this turns one into text and links, keeping a link only when it's
// http(s). Anything else (other tags, scripts, event handlers) can only come out as plain text.
// No runtime imports, so Node can run the tests directly.

export type CreditPart = { text: string; href?: string }

const LINK = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

/** One source's credit as text and links, in order. */
export function parseCredit(html: string): CreditPart[] {
  const parts: CreditPart[] = []
  const pushText = (raw: string) => {
    const text = toText(raw)
    if (text) parts.push({ text })
  }
  let last = 0
  for (const match of html.matchAll(LINK)) {
    pushText(html.slice(last, match.index))
    last = match.index + match[0].length
    const text = toText(match[2]!)
    if (!text) continue
    const quoted = HREF.exec(match[1]!)
    const href = quoted ? decodeEntities(quoted[1] ?? quoted[2] ?? quoted[3] ?? '').trim() : ''
    parts.push(/^https?:\/\//i.test(href) ? { text, href } : { text })
  }
  pushText(html.slice(last))
  return parts
}

/** Text without tags, entities decoded, runs of whitespace as one space. */
function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return NAMED[name.toLowerCase()] ?? entity
  })
}
