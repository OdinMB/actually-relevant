/**
 * A tile's label as the card shows it (`.context/story-context.md`, "Tiles and charts"): a card says
 * nothing twice. Its footer names the date its facts are from ("As of 2026"), so a trailing year in
 * the label that is the card's as-of year goes; and on a card with one tile the heading already says
 * what the number counts when every content word of the label is in it, so the label goes. With
 * several tiles each keeps its label, which tells them apart. Applied when a tile is served, so
 * cards stored before the rule get it too. Pure.
 */

/** Words that add nothing to what a label names. */
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'by', 'at', 'per', 'with', 'from', 'as', 'its', 'their'])

/** A text's content words, compared without case, punctuation or a plural "s". */
function contentWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w !== '' && !FUNCTION_WORDS.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

/** The label without a trailing year the footer gives: ", 2026", " in 2026", " as of 2026", " (2026)". */
function withoutAsOfYear(label: string, asOf: string | null): string {
  const year = asOf?.slice(0, 4)
  if (!year || !/^\d{4}$/.test(year)) return label
  return label.replace(new RegExp(String.raw`(?:(?:\s*,\s*|\s+(?:in|as of)\s+)${year}|\s*\(${year}\))\s*$`, 'i'), '')
}

export interface TileCard {
  heading: string
  /** The card's as-of (`YYYY-MM-DD`, `YYYY-MM` or `YYYY`), which its footer shows; null without one. */
  asOf: string | null
  /** How many tiles the card shows. */
  tiles: number
}

/** The label to show under a tile's number: empty when it would only repeat the card. */
export function tileLabel(label: string, card: TileCard): string {
  const shown = withoutAsOfYear(label.trim(), card.asOf).trim()
  if (card.tiles !== 1) return shown
  const heading = new Set(contentWords(card.heading))
  return contentWords(shown).every(w => heading.has(w)) ? '' : shown
}
