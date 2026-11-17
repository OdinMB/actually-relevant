import type { ContextBoxView } from '@shared/types'

/** The longest sentence a short card may hold: about three lines on a phone. */
export const SHORT_SENTENCE_CHARS = 120

/**
 * Whether a card is short enough to show in full on a phone, in place of the one-line note that
 * opens it in the sheet (`.context/public-website.md`, "Story context"; owner 2026-11-17). A short
 * card holds one thing that reads at a glance:
 * - a single number: one tile with one value, and no sentence; or
 * - one sentence of at most `SHORT_SENTENCE_CHARS` characters, and no visual.
 * A chart, several tiles, a tile whose sources disagree, several sentences, or a number with a
 * sentence keep the note.
 */
export function isShortCard({ visual, sentences }: Pick<ContextBoxView, 'visual' | 'sentences'>): boolean {
  if (visual === null) return sentences.length === 1 && sentences[0]!.text.length <= SHORT_SENTENCE_CHARS
  if (visual.kind !== 'tiles' || sentences.length > 0) return false
  return visual.tiles.length === 1 && visual.tiles[0]!.values.length === 1
}
