/**
 * TDMRep (W3C TDM Reservation Protocol) as the source policy reads it: the rules of a host's
 * `/.well-known/tdmrep.json`, and the `tdm-reservation` header or meta tag of a fetched page. A
 * reservation of 1 reserves text and data mining. Pure: fetching is the caller's.
 */
import { matchesPathPattern } from './robotsTxt.js'

export interface TdmRule {
  /** A path pattern, read like a robots.txt one (`*`, a final `$`). */
  location: string
  reserved: boolean
}

/** The rules of a tdmrep.json; none for a missing, invalid or non-array file, and a malformed entry is passed over. */
export function parseTdmRep(text: string): TdmRule[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { location, 'tdm-reservation': reservation } = entry as Record<string, unknown>
    if (typeof location !== 'string' || location === '') return []
    return [{ location, reserved: isReserving(reservation) }]
  })
}

function isReserving(value: unknown): boolean {
  return value === 1 || (typeof value === 'string' && value.trim() === '1')
}

/** Whether any reserving rule matches the path (pathname plus query), wherever it stands in the file. */
export function isTdmReserved(rules: readonly TdmRule[], path: string): boolean {
  return rules.some(rule => rule.reserved && matchesPathPattern(rule.location, path))
}

/** Attributes of one HTML tag: name (lowercased) to value, quoted or not. */
function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const [, name, doubleQuoted, singleQuoted, bare] of tag.matchAll(/([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    if (name) attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? bare ?? '')
  }
  return attributes
}

/**
 * Why a fetched page is reserved, from its `tdm-reservation` response header or
 * `<meta name="tdm-reservation" content="1">`; null when neither reserves. Scans the markup with
 * linear regexes rather than a DOM, so it also runs on pages too large to parse.
 */
export function pageTdmReservation(header: unknown, html: string): string | null {
  if (isReserving(header)) return 'TDMRep reservation (tdm-reservation header)'
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(tag)
    if (attributes.get('name')?.toLowerCase() === 'tdm-reservation' && isReserving(attributes.get('content'))) {
      return 'TDMRep reservation (tdm-reservation meta tag)'
    }
  }
  return null
}
