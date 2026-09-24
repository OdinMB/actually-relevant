/**
 * Which of a story's names and numbers a social post repeats, and which names
 * it adds: the "main actor or one key number" rule for social posts and a
 * pointer for the embellishment spot check. Pure heuristics over plain text.
 */
import { occursIn, readNumbers, significant, type NumberToken } from './numbers.js'

const WORD_RE = /\p{L}[\p{L}\p{M}\p{N}'’-]*/gu
/** Capitalised mid-sentence without naming an actor: dates, and acronyms for topics rather than organisations. */
const NOT_ACTORS = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'AI', 'HIV', 'AIDS', 'COVID', 'GDP', 'LLM', 'LLMs', 'CO2', 'GHG', 'EV', 'EVs',
])
const isAcronym = (w: string) => /^\p{Lu}[\p{Lu}\p{N}]+$/u.test(w)
const bareWord = (w: string) => w.replace(/['’]s$/u, '').replace(/['’-]+$/u, '')
/** "COVID-19" is judged by "COVID". */
const notAnActor = (w: string) => NOT_ACTORS.has(w.split('-')[0])
const capitalised = (w: string) => w.length >= 2 && /^\p{Lu}/u.test(w) && !notAnActor(w)

/** Whether the word at `index` opens a sentence, a line or the text (after any quote or bracket). */
function opensSentence(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/["'“‘([ \t]+$/u, '')
  return before === '' || /[.!?:;\n]$/.test(before)
}

/**
 * Proper names in a story: capitalised words that appear somewhere other than
 * at the start of a sentence, plus acronyms. A word capitalised only because it
 * opens a sentence ("Tariffs fall…") is not a name.
 */
function storyNames(story: string): Set<string> {
  const names = new Set<string>()
  for (const m of story.matchAll(WORD_RE)) {
    const word = bareWord(m[0])
    if (capitalised(word) && (isAcronym(word) || !opensSentence(story, m.index ?? 0))) names.add(word)
  }
  return names
}

/** "COVID-19" names a disease, not a number. */
const partOfName = (text: string, t: NumberToken) => /\p{L}-$/u.test(text.slice(Math.max(0, t.index - 2), t.index))

/**
 * The story's names and numbers that a post repeats, in reading order.
 * Numbers count only when the story states them, so an embellished figure is
 * no anchor.
 */
export function findStoryAnchors(post: string, story: string): string[] {
  const names = storyNames(story)
  const sourceValues = readNumbers(story).flatMap(t => t.values)
  const found = [
    ...[...post.matchAll(WORD_RE)].map(m => ({ at: m.index ?? 0, text: bareWord(m[0]) })).filter(w => names.has(w.text)),
    ...readNumbers(post)
      .filter(t => significant(t) && !partOfName(post, t) && occursIn(t, sourceValues))
      .map(t => ({ at: t.index, text: t.raw })),
  ]
  return [...new Set(found.sort((a, b) => a.at - b.at).map(f => f.text))]
}

/**
 * Names in a post that the story never mentions (any case). Words opening a
 * post sentence and hashtags are skipped, since those are capitalised for
 * other reasons.
 */
export function findUnstatedNames(post: string, story: string): string[] {
  const known = story.toLowerCase()
  const added = [...post.matchAll(WORD_RE)].flatMap(m => {
    const at = m.index ?? 0
    const word = bareWord(m[0])
    if (!capitalised(word) || post[at - 1] === '#') return []
    if (!isAcronym(word) && opensSentence(post, at)) return []
    return known.includes(word.toLowerCase()) ? [] : [word]
  })
  return [...new Set(added)]
}
