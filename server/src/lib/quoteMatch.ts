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

/** A text's words after `normalizeQuote` and lowercasing: each a maximal run of letters and digits, so punctuation and spacing never count. */
const wordsOf = (text: string): string[][] =>
  (
    normalizeQuote(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).map(w => [...w])

/** The shortest a word may be and still differ: a shorter one must match exactly. */
const NEAR_MIN_LETTERS = 5

/** Edit distance between two words, as code points. */
function editDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = row
  }
  return previous[b.length]!
}

/**
 * Whether a quote's word stands for a text's word: the same, or, when neither holds a digit and both
 * have at least 5 letters, within one edit per 5 letters of the longer (Bundibyo for Bundibugyo).
 */
function nearWord(q: readonly string[], t: readonly string[]): boolean {
  if (q.length === t.length && q.every((c, i) => c === t[i])) return true
  if (q.length < NEAR_MIN_LETTERS || t.length < NEAR_MIN_LETTERS || [...q, ...t].some(c => /\p{N}/u.test(c))) return false
  return editDistance(q, t) <= Math.floor(Math.max(q.length, t.length) / NEAR_MIN_LETTERS)
}

/**
 * `quoteFound`, or a word-level near match (`.context/overviews.md`, "How a story is linked", step 3):
 * the quote's words match a run of one text's words one for one, in order, where a word holding a
 * digit and every word under 5 letters match exactly and a longer word may differ by one edit per 5
 * letters of the longer word. So every quote `quoteFound` finds is found, and a model's small
 * misspelling of a long name passes, while Iran and Iraq, Uganda and Rwanda, or 100,000 and 10,000 stay
 * apart. For the link step's quotes; the answer keys and research keep the exact `quoteFound`.
 */
export function quoteNearlyFound(quote: string, texts: readonly string[]): boolean {
  if (quoteFound(quote, texts)) return true
  const q = wordsOf(quote)
  if (q.length === 0) return false
  return texts.some(text => {
    const words = wordsOf(text)
    for (let i = 0; i + q.length <= words.length; i++) if (q.every((w, j) => nearWord(w, words[i + j]!))) return true
    return false
  })
}
