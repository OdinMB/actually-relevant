/**
 * Finding a quoted phrase in a text, as the overview evals find an answer key's quotes in our
 * published stories and the overview link step finds a model's quotes in the texts it was shown
 * (`.context/overviews.md`, "How a story is linked"). Pure.
 */

/** Whitespace runs to one space, curly and angle quote marks to straight ones, every dash to a hyphen. Case and words stay. */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[‘’‚‛′‹›`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether `quote` occurs in one of `texts` after `normalizeQuote`, case aside (a quote that starts a
 * sentence in one text and sits mid-sentence in the other is the same words). An empty quote, or one
 * with no letter or digit, is found nowhere.
 */
export function quoteFound(quote: string, texts: readonly string[]): boolean {
  const q = normalizeQuote(quote).toLowerCase()
  if (!/[\p{L}\p{N}]/u.test(q)) return false
  return texts.some(t => normalizeQuote(t).toLowerCase().includes(q))
}
