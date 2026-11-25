/**
 * What readers are quoted of a source: the one sentence of a fact's support that states it
 * (`quotedSentence`), and a text's citations, one per source (`citationsOf`). Pure.
 *
 * A fact's support may hold two adjacent sentences, the stating one and the one naming its speaker,
 * subject or period, and an extraction sometimes copies more. The checks, the writers and the admin
 * keep the whole support; everything a reader sees quotes one sentence (owner, 2026-11-25). The
 * splitter is cautious: a false split cuts a one-sentence quote short, which is worse than showing
 * two sentences once in a while, and nine supports in ten are one sentence
 * (`.context/story-research.md`, "What a card quotes").
 */

export interface QuotedFact {
  statement: string
  supportingSentence: string
}

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

/** Where a search engine joined two passages of a page ("[...]"): never inside a sentence, so always a break, and never quoted. */
const JOINED = /\s*\[(?:\.{3}|…)\]\s*/u

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
  if (stop !== '.') return false
  const before = /(\p{L}+|\d+)$/u.exec(passage.slice(0, m.index))?.[1] ?? ''
  // An initial or a dotted abbreviation ("J. D. Vance", "U.S. Navy", "10 a.m. EDT"), or a day or an ordinal ("am 12. November")
  if (before.length === 1 || /^\d{1,2}$/.test(before)) return true
  // A title, company form or month ("Gen. …", "Inc. …", "Nov. …")
  const lower = before.toLowerCase()
  return ABBREVIATIONS.has(lower) || (before !== lower && CAPITALIZED_ABBREVIATIONS.has(lower))
}

/** A support's sentences in order, each trimmed; where in doubt, two stay together. A piece without a letter or a digit is none. */
function sentencesOf(text: string): string[] {
  return text.split(JOINED).flatMap(passage => {
    const sentences: string[] = []
    let from = 0
    for (const m of passage.matchAll(STOP)) {
      if (goesOn(passage, m)) continue
      const end = m.index + m[0].length
      sentences.push(passage.slice(from, end).trim())
      from = end
    }
    return [...sentences, passage.slice(from).trim()].filter(sentence => /[\p{L}\p{N}]/u.test(sentence))
  })
}

/** A digit run that is a number of its own, never the digits of a name ("H5N1", "A320", "COVID-19"). */
const NUMBER = /(?<![\p{Script=Latin}\d])(?<!\p{Script=Latin}[-‐‑–])(?<!\d[.,])\d+(?:[.,]\d+)*/gu

const lowered = (text: string): string => text.normalize('NFKC').toLowerCase()

/** The numbers of a lower-case text, without their separators: "6,000" and "6.000" are both 6000. */
const numbersOf = (lower: string): ReadonlySet<string> => new Set((lower.match(NUMBER) ?? []).map(n => n.replace(/[.,]/g, '')))

/** What a sentence can share with a statement: its numbers, and its words of four characters or more. */
function terms(text: string): ReadonlySet<string> {
  const lower = lowered(text)
  return new Set([...numbersOf(lower), ...(lower.match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 4 && /\p{L}/u.test(w))])
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const DAY = '(?:3[01]|[12]?\\d)'

/**
 * In a statement, which is English: the numbers that only date it, a year and a day beside its month
 * ("November 3", "3 November"). A number before "may" stays a figure ("as many as 40 may have died"),
 * and so does one that only starts after a month ("in March 5,000 people").
 */
const DATE = new RegExp(`\\b(?:19|20)\\d{2}\\b|\\b(?:${MONTHS}|may)\\.? ${DAY}\\b(?![.,]\\d)|(?<![.,\\d])\\b${DAY} (?:${MONTHS})\\b`, 'g')

/** A statement's figures: its numbers other than those of its date, which the neighboring sentence may give as well as the stating one. */
const figuresOf = (statement: string): ReadonlySet<string> => numbersOf(lowered(statement).replace(DATE, ' '))

const shared = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => [...a].filter(term => b.has(term)).length

/**
 * The one sentence of the fact's support that readers are shown. Of several, the one that gives the
 * most of the statement's figures, then the one sharing the most words and numbers with it, then the
 * later one. Figures come first because a statement names its speaker in the words the neighboring
 * sentence uses, while it restates the fact in its own; a tie goes to the later sentence because the
 * one before it usually only names the speaker or the period.
 */
export function quotedSentence(fact: QuotedFact): string {
  const sentences = sentencesOf(fact.supportingSentence)
  if (sentences.length < 2) return sentences[0] ?? ''
  const stated = terms(fact.statement)
  const figures = figuresOf(fact.statement)
  let best = { sentence: '', figures: -1, terms: -1 }
  for (const sentence of sentences) {
    const has = terms(sentence)
    const found = { sentence, figures: shared(has, figures), terms: shared(has, stated) }
    if (found.figures > best.figures || (found.figures === best.figures && found.terms >= best.terms)) best = found
  }
  return best.sentence
}

/**
 * One citation per source, in first-cited order, each quoting one sentence of that source's first
 * cited fact that has a support; null for a source cited only by facts without one (its date).
 */
export function citationsOf(cited: Iterable<{ sourceId: string; fact: QuotedFact }>): { sourceId: string; sentence: string | null }[] {
  const bySource = new Map<string, { sourceId: string; sentence: string | null }>()
  for (const { sourceId, fact } of cited) {
    const sentence = quotedSentence(fact) || null
    const known = bySource.get(sourceId)
    if (!known) bySource.set(sourceId, { sourceId, sentence })
    else if (known.sentence === null && sentence) known.sentence = sentence
  }
  return [...bySource.values()]
}
