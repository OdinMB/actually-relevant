/** Escape text for an XML element or attribute value (prompts, feeds). */
export function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Undo escapeXml, plus the numeric apostrophe forms. A model reading escaped prompt text copies
 * the escapes back into what it writes; `&amp;` goes last so `&amp;lt;` stays `&lt;`.
 */
export function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
}

/** unescapeXml on every string of a parsed model answer, however nested. */
export function unescapeXmlDeep<T>(value: T): T {
  if (typeof value === 'string') return unescapeXml(value) as T
  if (Array.isArray(value)) return value.map(v => unescapeXmlDeep(v)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unescapeXmlDeep(v)])) as T
  return value
}

/** Escape text for an HTML element or attribute value (the newsletter email, story page head tags). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
