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

/** Whether `q` is `t` with letters left out: every letter of `q` in `t`, in order. */
function isSubsequence(q: readonly string[], t: readonly string[]): boolean {
  let j = 0
  for (const c of t) if (j < q.length && c === q[j]) j++
  return j === q.length
}

/**
 * Whether a quote's word stands for a text's word: the same, or, when neither holds a digit and both
 * have at least 5 letters, the text's word with letters left out, the first kept, at most one per 5
 * letters of the text's word (Bundibyo for Bundibugyo). Only deletions: a changed or added letter
 * never passes, since that is how two real place names differ (Gambia and Zambia, Colombia and Columbia).
 */
function nearWord(q: readonly string[], t: readonly string[]): boolean {
  if (q.length === t.length && q.every((c, i) => c === t[i])) return true
  if (q.length < NEAR_MIN_LETTERS || t.length < NEAR_MIN_LETTERS || [...q, ...t].some(c => /\p{N}/u.test(c))) return false
  const missing = t.length - q.length
  return missing > 0 && missing <= Math.floor(t.length / NEAR_MIN_LETTERS) && q[0] === t[0] && isSubsequence(q, t)
}

/**
 * `quoteFound`, or a word-level near match (`.context/overviews.md`, "How a story is linked", step 3):
 * the quote's words match a run of one text's words one for one, in order, where a word holding a
 * digit and every word under 5 letters match exactly and a longer word may be the text's word with up
 * to one letter per 5 left out (never the first, never a letter changed or added). So every quote
 * `quoteFound` finds is found, and a model's dropped letters in a long name pass, while Iran and Iraq,
 * Uganda and Rwanda, Gambia and Zambia, Colombia and Columbia, or 100,000 and 10,000 stay apart.
 * Known gap: two real words that differ only by letters left out of the longer still match, such as
 * Austrian for Australian (two of ten), though not Austria for Australia (two of nine). A misspelling
 * that changes a letter (Bundibugio) is refused. For the link step's quotes; the answer keys and
 * research keep the exact `quoteFound`.
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
