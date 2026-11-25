/**
 * Where a sentence ends in running text (`sentenceEnds`), and a text cut to a length at the last
 * sentence end before it (`cutAtSentenceEnd`). Pure. Readers' quotes split a fact's support at these
 * ends (`services/readerQuotes.ts`); research's loader cuts the article texts we hold at them
 * (`services/researchInput.ts`, owner decision 2026-11-25), so that an extraction does not read a
 * last sentence cut in half. `sentenceEnds` is cautious, as a quote needs it: where in doubt, no end.
 */

const listed = (...lines: string[]): ReadonlySet<string> => new Set(lines.flatMap(line => line.split(' ')))

/**
 * Titles, company forms and months that a name or a noun follows, so the stop after one ends no
 * sentence. Only where they are capitalized: in lower case the same letters are words that end
 * sentences in other languages (Swedish "hon", Spanish "mar").
 */
const CAPITALIZED_ABBREVIATIONS = listed(
  'mr mrs ms dr drs prof sr jr st mt ft messrs mme mlle sra srta dra sig dott hr fr nr',
  'gen lt col sgt cpl pvt capt cmdr adm maj brig sen sens rep reps gov govs pres rev hon atty asst sec amb det supt',
  'inc corp co ltd bros ee uu',
  'jan feb mar apr jun jul aug sep sept oct nov dec',
)

/** Abbreviations written in either case that a noun follows. */
const ABBREVIATIONS = listed('vs mio mrd tsd sog bzw inkl ggf ehem stellv')

/**
 * Where a sentence may end inside a passage: a stop, its closing marks and the space after it, before a
 * capital or caseless letter (an opening mark may come first); or a CJK stop with its closing marks,
 * which needs no space after it, before anything but a closing mark it left behind.
 */
const STOP = /([.!?…]+)(["'”’»)\]]*)\s+(?=["'“‘«([]?[\p{Lu}\p{Lt}\p{Lo}])|([。！？]+)(["”’」』）]*)\s*(?=[^\s"”’」』）])/gu

/** Whether the sentence goes on past the stop a match found. */
function goesOn(passage: string, m: RegExpExecArray): boolean {
  const quoted = /["'”’»」』]/.test(m[2] ?? m[4] ?? '')
  // '“我们准备好了。”他说。' is one sentence: a quotation that ends at a CJK stop goes on with who said it
  if (m[3] !== undefined) return quoted
  const stop = m[1] ?? ''
  // '"We are all on board!" Mayor Ruiz wrote.' is one sentence too: a quoted question or exclamation
  if (quoted && /[!?]$/.test(stop)) return true
  // '"We are close ... I think so"': after words left out, the one word that takes a capital inside a sentence
  if (/…|\.\./.test(stop) && /^["'“‘«([]?I\b/u.test(passage.slice(m.index + m[0].length))) return true
  return stop === '.' && abbreviates(passage, m.index)
}

/** Whether the period at `index` closes an abbreviation, an initial or a number rather than a sentence. */
function abbreviates(passage: string, index: number): boolean {
  const before = /(\p{L}+|\d+)$/u.exec(passage.slice(0, index))?.[1] ?? ''
  // An initial or a dotted abbreviation ("J. D. Vance", "U.S. Navy", "10 a.m. EDT"), or a day or an ordinal ("am 12. November")
  if (before.length === 1 || /^\d{1,2}$/.test(before)) return true
  // A title, company form or month ("Gen. …", "Inc. …", "Nov. …")
  const lower = before.toLowerCase()
  return ABBREVIATIONS.has(lower) || (before !== lower && CAPITALIZED_ABBREVIATIONS.has(lower))
}

/**
 * Where each sentence of a passage ends, in order: the index just past its stop and closing marks,
 * before the space that follows. The passage's last sentence, which nothing follows, has none.
 */
export function sentenceEnds(passage: string): number[] {
  const ends: number[] = []
  for (const m of passage.matchAll(STOP)) {
    if (goesOn(passage, m)) continue
    ends.push(m.index + (m[1] ?? m[3] ?? '').length + (m[2] ?? m[4] ?? '').length)
  }
  return ends
}

/**
 * A stop with no space after it, between a lower-case letter or a digit and a capital or an opening
 * quote: where a scraped text joined two paragraphs ("…on Monday.The ministry said"). Too bold for
 * a quote, since a dotted name or an address can look the same, so only the cut reads it, and only
 * where the stretch holds no spaced end: a wrong one there is no worse than the cut at the limit.
 */
const JOINED_STOP = /(?<=[\p{Ll}\d])[.!?]["'”’»)\]]*(?=["'“‘«]?\p{Lu})/gu

/** Where a passage's joined sentences end (`JOINED_STOP`), in order, a title's or an abbreviation's period left out. */
function joinedEnds(passage: string): number[] {
  return [...passage.matchAll(JOINED_STOP)].filter(m => m[0][0] !== '.' || !abbreviates(passage, m.index)).map(m => m.index + m[0].length)
}

/** How far before the limit a cut looks for an end; with none that near, the text is cut at the limit. */
export const NEAR_CHARS = 500
/** Text read on each side of that stretch: before it, so the word before a stop is whole; after the limit, to see what follows a stop there. */
const CONTEXT_CHARS = 100

/**
 * `text` cut to at most `maxChars` at an end within `NEAR_CHARS` of the limit, without the space
 * before the cut; whole when it fits. The end is the stretch's last sentence end; where it holds
 * none, its last line break (a list, a table), which is never taken before a sentence end because a
 * heading, a caption or a wrapped line may follow it; then its last stop with no space after it
 * (`JOINED_STOP`); and with none of these the limit itself. Only the stretch around the limit is
 * read: an article can be long, and each stop found reads the passage before it.
 *
 * The evals cache what research's loader makes of this: a change to where it cuts (the abbreviation
 * lists included) raises both caches' versions (`PASS_INPUTS_VERSION`, `RESEARCH_FIXTURES_VERSION`;
 * `.context/model-eval.md`, "The cached inputs").
 */
export function cutAtSentenceEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  // The earliest end taken; never the text's start, which would leave nothing
  const near = Math.max(1, maxChars - NEAR_CHARS)
  const from = Math.max(0, near - CONTEXT_CHARS)
  const stretch = text.slice(from, maxChars + CONTEXT_CHARS)
  const lastWithin = (ends: number[]) =>
    ends
      .map(end => from + end)
      .filter(end => end >= near && end <= maxChars)
      .at(-1)
  const lineBreak = text.lastIndexOf('\n', maxChars)
  const end = lastWithin(sentenceEnds(stretch)) ?? (lineBreak >= near ? lineBreak : undefined) ?? lastWithin(joinedEnds(stretch))
  return end === undefined ? text.slice(0, maxChars) : text.slice(0, end).trimEnd()
}
