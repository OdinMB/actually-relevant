/**
 * The variants of an extracted fact's statement that `eval:overviews` puts to the fact check, each
 * labeled by construction (`.context/model-eval.md`, "Overview evals"): the statement as extracted,
 * one faithful rewording, and one planted error per kind. Every rule changes one number, read with
 * production's number reader (`readNumbers`, the reader behind the fact check's hints), and never
 * one inside a word or an id (`S2F3`, `5G`, `COVID-19`) or in a URL-like string. Pure.
 */
import { readNumbers, significant, type NumberToken } from '../../../lib/numbers.js'

export const FAITHFUL_KINDS = ['faithful', 'reworded'] as const
export const PLANTED_KINDS = ['wrong-number', 'dropped-qualifier', 'wrong-year', 'wrong-scale'] as const
export const VARIANT_KINDS = [...FAITHFUL_KINDS, ...PLANTED_KINDS] as const
export type PlantedKind = (typeof PLANTED_KINDS)[number]
export type VariantKind = (typeof VARIANT_KINDS)[number]

/** What a correct fact check answers: the statement and its rewording are supported, every planted error is not. */
export const expectedSupported = (kind: VariantKind): boolean => kind === 'faithful' || kind === 'reworded'

export interface Planted {
  text: string
  /** The one change, e.g. `4,887 → 7,331`; empty for the faithful variant. */
  change: string
}

export interface Variant extends Planted {
  kind: VariantKind
}

/** A number in the text, with its span. */
export interface PlantableNumber {
  start: number
  end: number
  raw: string
  token: NumberToken
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
const URL_LIKE = /[/\\@]|www\.|\p{L}\.\p{L}{2,}/iu

/** The whitespace-delimited stretch of text a span sits in. */
function chunkAround(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && !/\s/.test(text[from - 1] ?? '')) from--
  let to = end
  while (to < text.length && !/\s/.test(text[to] ?? '')) to++
  return text.slice(from, to)
}

/** The numbers a rule may change, in text order. */
export function plantableNumbers(text: string): PlantableNumber[] {
  return readNumbers(text)
    .map(token => ({ start: token.index, end: token.index + token.raw.length, raw: token.raw, token }))
    .filter(n => {
      const before = text[n.start - 1] ?? ''
      if (LETTER_OR_DIGIT.test(before) || LETTER_OR_DIGIT.test(text[n.end] ?? '')) return false
      // An id such as COVID-19 or B-52
      if (before === '-' && /\p{L}/u.test(text[n.start - 2] ?? '')) return false
      return !URL_LIKE.test(chunkAround(text, n.start, n.end))
    })
    .sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------------------
// Reading and writing a number in its own format
// ---------------------------------------------------------------------------

interface Parts {
  /** A currency sign, with its space. */
  prefix: string
  digits: string
  /** `%`, `percent` or a scale word, with the space before it. */
  suffix: string
}

const PARTS = /^([$€£¥]\s?)?(\d(?:[\d,.   ]*\d)?)(.*)$/su

function partsOf(raw: string): Parts | null {
  const m = PARTS.exec(raw)
  return m ? { prefix: m[1] ?? '', digits: m[2] ?? '', suffix: m[3] ?? '' } : null
}

interface Format {
  value: number
  decimals: number
  /** The thousands separator, if the number has one. */
  group: string | null
}

/** An unambiguous number: plain, grouped by a comma or a space, with or without decimals. `1.200` and `4,5` read two ways and give null. */
function formatOf(digits: string): Format | null {
  if (/^\d+$/.test(digits)) return { value: Number(digits), decimals: 0, group: null }
  const grouped = /^\d{1,3}([,   ])\d{3}(?:\1\d{3})*(?:\.(\d+))?$/u.exec(digits)
  if (grouped) {
    const group = grouped[1] ?? ','
    return { value: Number(digits.split(group).join('')), decimals: grouped[2]?.length ?? 0, group }
  }
  if (/^\d+\.\d+$/.test(digits) && !/^\d{1,3}(\.\d{3})+$/.test(digits))
    return { value: Number(digits), decimals: digits.split('.')[1]?.length ?? 0, group: null }
  return null
}

function formatNumber(value: number, f: Format): string {
  const [int = '', dec] = value.toFixed(f.decimals).split('.')
  const grouped = f.group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, f.group) : int
  return dec === undefined ? grouped : `${grouped}.${dec}`
}

const isYear = (n: PlantableNumber) => !n.token.marked && /^\d{4}$/.test(n.raw) && Number(n.raw) >= 1900 && Number(n.raw) <= 2099

const replaced = (text: string, span: { start: number; end: number }, insert: string) => text.slice(0, span.start) + insert + text.slice(span.end)

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const atStart = (text: string, n: PlantableNumber) => text.slice(0, n.start).trim() === ''

const wordBefore = (text: string, start: number) => /(\p{L}+)\s+$/u.exec(text.slice(0, start))?.[1]?.toLowerCase() ?? ''
const wordAfter = (text: string, end: number) => /^\s+(\p{L}+)/u.exec(text.slice(end))?.[1]?.toLowerCase() ?? ''

const PERCENT = /^\s*(%|percent|per cent)$/i

/** A word or phrase that already qualifies the number after it. */
const QUALIFIED =
  /(^|[^\p{L}\p{N}])(more than|less than|fewer than|at least|at most|up to|close to|nearly|almost|about|around|approximately|roughly|over|under|some)\s+$/iu

// ---------------------------------------------------------------------------
// reworded: one faithful change
// ---------------------------------------------------------------------------

const FRACTIONS: Record<number, string> = { 50: 'half', 25: 'a quarter', 75: 'three quarters' }

/** 50% → half, 25% → a quarter, 75% → three quarters, where the sentence stays grammatical ("50% of", "by 25%"). */
function fraction(text: string, n: PlantableNumber): Planted | null {
  const p = partsOf(n.raw)
  if (!p || p.prefix || !PERCENT.test(p.suffix)) return null
  const word = FRACTIONS[formatOf(p.digits)?.value ?? NaN]
  if (!word || (wordAfter(text, n.end) !== 'of' && wordBefore(text, n.start) !== 'by')) return null
  const insert = atStart(text, n) ? capitalized(word) : word
  return { text: replaced(text, n, insert), change: `${n.raw} → ${insert}` }
}

/** A whole million in the other form: 2,000,000 ↔ 2 million. */
function millionForm(text: string, n: PlantableNumber): Planted | null {
  const p = partsOf(n.raw)
  const f = p && formatOf(p.digits)
  if (!p || !f || f.decimals > 0) return null
  let insert: string | null = null
  if (/^\s*million$/i.test(p.suffix) && f.value >= 1 && f.value <= 999) insert = `${p.prefix}${f.value},000,000`
  else if (p.suffix === '' && f.value % 1e6 === 0 && f.value >= 1e6 && f.value <= 999e6) insert = `${p.prefix}${f.value / 1e6} million`
  return insert === null ? null : { text: replaced(text, n, insert), change: `${n.raw} → ${insert}` }
}

/** A number of at least 1,000 rounded to two significant figures with "about": 4,887 → about 4,900. */
function rounded(text: string, n: PlantableNumber): Planted | null {
  const p = partsOf(n.raw)
  const f = p && formatOf(p.digits)
  if (!p || !f || f.value < 1000 || PERCENT.test(p.suffix) || isYear(n) || QUALIFIED.test(text.slice(0, n.start))) return null
  const unit = 10 ** (Math.floor(Math.log10(f.value)) - 1)
  const value = Math.round(f.value / unit) * unit
  if (value === f.value) return null
  const insert = `${atStart(text, n) ? 'About' : 'about'} ${p.prefix}${formatNumber(value, { ...f, decimals: 0 })}${p.suffix}`
  return { text: replaced(text, n, insert), change: `${n.raw} → ${insert}` }
}

/** The first rewording that applies, one change only; null when none does. */
export function reworded(text: string): Planted | null {
  for (const n of plantableNumbers(text)) {
    for (const rule of [fraction, millionForm, rounded]) {
      const planted = rule(text, n)
      if (planted) return planted
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Planted errors
// ---------------------------------------------------------------------------

/** One significant number (not a year) times 1.5 at its own precision, or times 2 where that leaves it unchanged. */
export function wrongNumber(text: string): Planted | null {
  for (const n of plantableNumbers(text)) {
    if (!significant(n.token) || isYear(n)) continue
    const p = partsOf(n.raw)
    const f = p && formatOf(p.digits)
    if (!p || !f) continue
    const changed = [1.5, 2].map(k => Number((f.value * k).toFixed(f.decimals))).find(v => v !== f.value)
    if (changed === undefined) continue
    const insert = `${p.prefix}${formatNumber(changed, f)}${p.suffix}`
    return { text: replaced(text, n, insert), change: `${n.raw} → ${insert}` }
  }
  return null
}

const DROPPABLE = /(^|[^\p{L}\p{N}])(more than|at least|up to|nearly|almost|about|around|over|some)\s+$/iu
const NEGATED = /(^|[^\p{L}])(no|not)\s+$/iu

/** "nearly", "almost", "about", "around", "more than", "over", "at least", "up to" or "some" removed before a number. */
export function droppedQualifier(text: string): Planted | null {
  for (const n of plantableNumbers(text)) {
    const before = text.slice(0, n.start)
    const m = DROPPABLE.exec(before)
    const qualifier = m?.[2]
    if (!m || !qualifier) continue
    const from = m.index + (m[1]?.length ?? 0)
    if (NEGATED.test(before.slice(0, from))) continue
    const rest = text.slice(n.start)
    return { text: text.slice(0, from) + (/^\p{Lu}/u.test(qualifier) ? capitalized(rest) : rest), change: `${qualifier} ${n.raw} → ${n.raw}` }
  }
  return null
}

/** The first year from 1900 to 2099, moved back by one. */
export function wrongYear(text: string): Planted | null {
  const n = plantableNumbers(text).find(isYear)
  if (!n) return null
  const year = String(Number(n.raw) - 1)
  return { text: replaced(text, n, year), change: `${n.raw} → ${year}` }
}

const SCALE_SWAP: Record<string, string> = { thousand: 'million', million: 'billion', billion: 'million' }

/** The first number's scale word swapped: thousand → million → billion → million. */
export function wrongScale(text: string): Planted | null {
  for (const n of plantableNumbers(text)) {
    const word = /(thousand|million|billion)$/i.exec(n.raw)?.[1]
    const to = word && SCALE_SWAP[word.toLowerCase()]
    if (!word || !to) continue
    const swapped = /^\p{Lu}/u.test(word) ? capitalized(to) : to
    const insert = n.raw.slice(0, -word.length) + swapped
    return { text: replaced(text, n, insert), change: `${n.raw} → ${insert}` }
  }
  return null
}

const RULES: [Exclude<VariantKind, 'faithful'>, (text: string) => Planted | null][] = [
  ['reworded', reworded],
  ['wrong-number', wrongNumber],
  ['dropped-qualifier', droppedQualifier],
  ['wrong-year', wrongYear],
  ['wrong-scale', wrongScale],
]

/** The statement as extracted, then each kind whose rule applies, in `VARIANT_KINDS` order. */
export function plantVariants(statement: string): Variant[] {
  return [
    { kind: 'faithful', text: statement, change: '' },
    ...RULES.flatMap(([kind, rule]): Variant[] => {
      const planted = rule(statement)
      return planted && planted.text !== statement ? [{ kind, ...planted }] : []
    }),
  ]
}
