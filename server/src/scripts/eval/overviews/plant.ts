/**
 * The variants of an extracted fact's statement that `eval:overviews` puts to the fact check, each
 * labeled by construction (`.context/model-eval.md`, "Overview evals"): the statement as extracted,
 * one faithful rewording, and one planted error per kind. Every rule changes one number, read with
 * production's number reader (`readNumbers`, the reader behind the fact check's hints), and never
 * one inside a word or an id (`S2F3`, `5G`, `COVID-19`) or in a URL-like string. For module-1
 * facts (`--facts context`, `--facts pool`) these text kinds are planted in the fact's statement, and
 * four field-level kinds change one field of its record instead; production's `renderFact` renders
 * the fact again either way (`contextFacts.ts`). For the figure check (`figureCheck.ts`) one rule
 * changes a recorded figure's value (`wrongFigure`). The `update` step's corrections take every
 * candidate change of a statement (`wrongNumbers`, `wrongYears`) and keep the first a sanity check
 * lets through (`updatePlants.ts`). Pure.
 */
import { readNumbers, significant, type NumberToken } from '../../../lib/numbers.js'
import { RECORD_LABELS } from '../../../services/storyContextChecks.js'
import { statesValue } from './standsScore.js'

export const FAITHFUL_KINDS = ['faithful', 'reworded'] as const
/** The kinds that change one field of a module-1 fact's record before production renders it again (`--facts context`, `--facts pool`). */
export const FIELD_KINDS = ['wrong-place', 'wrong-as-of', 'wrong-credit', 'cumulative-swap'] as const
export const PLANTED_KINDS = ['wrong-number', 'dropped-qualifier', 'wrong-year', 'wrong-scale', ...FIELD_KINDS] as const
export const VARIANT_KINDS = [...FAITHFUL_KINDS, ...PLANTED_KINDS] as const
export type FieldKind = (typeof FIELD_KINDS)[number]
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

/** An unmarked four-digit number from 1900 to 2099: read as a year. */
export const isYear = (n: PlantableNumber) => !n.token.marked && /^\d{4}$/.test(n.raw) && Number(n.raw) >= 1900 && Number(n.raw) <= 2099

/** Unmarked, ungrouped and under 10,000: as often a year, a period's bound (1850-1900) or a name (Resolution 1701) as a count. */
const mayNotCount = (n: PlantableNumber, f: Format) => !n.token.marked && f.group === null && f.value < 10_000

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

/**
 * A number of at least 1,000 rounded to two significant figures with "about": 4,887 → about 4,900.
 * Never a bare four-digit number (`mayNotCount`), where "about" would misstate a year or a name.
 */
function rounded(text: string, n: PlantableNumber): Planted | null {
  const p = partsOf(n.raw)
  const f = p && formatOf(p.digits)
  if (!p || !f || f.value < 1000 || PERCENT.test(p.suffix) || mayNotCount(n, f) || QUALIFIED.test(text.slice(0, n.start))) return null
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

/** A number of a text changed on its own: the number, what went in its place, and the text with it. */
export interface NumberChange extends Planted {
  at: PlantableNumber
  insert: string
}

/** A number multiplied: the factor it was multiplied by besides. */
export interface ScaledChange extends NumberChange {
  factor: number
}

/** A number written as `raw` times `k` at its own precision, in its own format; null where it is unreadable or `k` leaves it unchanged. */
export function timesNumber(raw: string, k: number): string | null {
  const p = partsOf(raw)
  const f = p && formatOf(p.digits)
  if (!p || !f) return null
  const changed = Number((f.value * k).toFixed(f.decimals))
  return changed === f.value ? null : `${p.prefix}${formatNumber(changed, f)}${p.suffix}`
}

/** Each significant number (not a year) times 1.5 at its own precision, or times 2 where that leaves it unchanged, each on its own, in text order. */
export function wrongNumbers(text: string): ScaledChange[] {
  return plantableNumbers(text).flatMap((n): ScaledChange[] => {
    if (!significant(n.token) || isYear(n)) return []
    for (const factor of [1.5, 2]) {
      const insert = timesNumber(n.raw, factor)
      if (insert !== null) return [{ text: replaced(text, n, insert), change: `${n.raw} → ${insert}`, at: n, insert, factor }]
    }
    return []
  })
}

/** The first of `wrongNumbers`: one significant number (not a year) times 1.5, or times 2 where that leaves it unchanged. */
export function wrongNumber(text: string): Planted | null {
  const first = wrongNumbers(text)[0]
  return first ? { text: first.text, change: first.change } : null
}

const DROPPABLE = /(^|[^\p{L}\p{N}])(more than|at least|up to|nearly|almost|about|around|over|some)\s+$/iu
const NEGATED = /(^|[^\p{L}])(no|not)\s+$/iu

/** "nearly", "almost", "about", "around", "more than", "over", "at least", "up to" or "some" removed before a number, never before a year ("up 5% over 2024"). */
export function droppedQualifier(text: string): Planted | null {
  for (const n of plantableNumbers(text)) {
    if (isYear(n)) continue
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

/** Each year from 1900 to 2099 moved back by one, each on its own, in text order. */
export function wrongYears(text: string): NumberChange[] {
  return plantableNumbers(text)
    .filter(isYear)
    .map(n => {
      const insert = String(Number(n.raw) - 1)
      return { text: replaced(text, n, insert), change: `${n.raw} → ${insert}`, at: n, insert }
    })
}

/** The first of `wrongYears`: the first year from 1900 to 2099, moved back by one. */
export function wrongYear(text: string): Planted | null {
  const first = wrongYears(text)[0]
  return first ? { text: first.text, change: first.change } : null
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

// ---------------------------------------------------------------------------
// Field-level errors: one field of a module-1 fact's record changed, for production's renderFact.
// Each rule takes the fact's rendering as it stands (`rendered`: its statement, then its record) and
// its evidence (the sentence or passage the check reads), and leaves the fact alone where the change
// would not show in the record or where the evidence names the planted value too, so the variant
// stays wrong.
// ---------------------------------------------------------------------------

/** The structured fields a field-level kind may change. */
export interface PlantableFields {
  place: string
  asOf: string | null
  credited: string
  counted: string
}

/** Places and credited bodies named among the story's facts: where a swapped-in value comes from. */
export interface FieldPeers {
  places: string[]
  credits: string[]
}

export interface FieldPlanted {
  fields: Partial<PlantableFields>
  change: string
}

export interface FieldVariant extends FieldPlanted {
  kind: FieldKind
}

const lower = (s: string) => s.toLowerCase()

/** The first peer that differs from `value`, neither inside the other, named neither in the evidence nor in the rendering. */
export function otherPeer(value: string, peers: string[], rendered: string, evidence: string): string | null {
  const v = lower(value.trim())
  return (
    peers
      .map(p => p.trim())
      .find(p => {
        const q = lower(p)
        return q !== '' && q !== v && !q.includes(v) && !v.includes(q) && !lower(evidence).includes(q) && !lower(rendered).includes(q)
      }) ?? null
  )
}

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The rendering's record shows the field as `<label>: <value>` (`RECORD_LABELS`, production's
 * `renderFact`): the record's first field after "[Record: ", any other after "; ", and the field
 * ending at the next ";" or the closing "]". A value the statement or another field names does not count.
 */
const showsField = (rendered: string, label: string, value: string) =>
  new RegExp(`(?:\\[${escaped(RECORD_LABELS.record)}: |; )${escaped(label)}: ${escaped(value)}(?=;|\\])`).test(rendered)

/** Another place among the story's facts, where the rendering's record shows the fact's own as its place field, "place: <place>". */
export function wrongPlace(f: PlantableFields, peers: FieldPeers, rendered: string, evidence: string): FieldPlanted | null {
  const place = f.place.trim()
  if (!place || !showsField(rendered, RECORD_LABELS.place, place)) return null
  const other = otherPeer(place, peers.places, rendered, evidence)
  return other ? { fields: { place: other }, change: `${place} → ${other}` } : null
}

/** Another credited body among the story's facts, where the rendering's record shows "credited to: <body>". */
export function wrongCredit(f: PlantableFields, peers: FieldPeers, rendered: string, evidence: string): FieldPlanted | null {
  const credited = f.credited.trim()
  if (!credited || !showsField(rendered, RECORD_LABELS.credited, credited)) return null
  const other = otherPeer(credited, peers.credits, rendered, evidence)
  return other ? { fields: { credited: other }, change: `${credited} → ${other}` } : null
}

const MONTH_STEMS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The as-of date one month back at its own precision (a day kept, or the month's last day), or one
 * year back for year precision; never to a month or year the evidence also names.
 */
export function wrongAsOf(f: PlantableFields, evidence: string): FieldPlanted | null {
  const asOf = f.asOf
  const m = asOf ? /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(asOf) : null
  if (!asOf || !m) return null
  const year = Number(m[1])
  if (m[2] === undefined) {
    const moved = String(year - 1)
    return evidence.includes(moved) ? null : { fields: { asOf: moved }, change: `${asOf} → ${moved}` }
  }
  const month = Number(m[2]) === 1 ? 12 : Number(m[2]) - 1
  const y = Number(m[2]) === 1 ? year - 1 : year
  if (new RegExp(`\\b${MONTH_STEMS[month - 1]}`, 'i').test(evidence)) return null
  const mm = String(month).padStart(2, '0')
  let moved = `${y}-${mm}`
  if (m[3] !== undefined) {
    const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate()
    moved += `-${String(Math.min(Number(m[3]), lastDay)).padStart(2, '0')}`
  }
  return { fields: { asOf: moved }, change: `${asOf} → ${moved}` }
}

const SWAPS: Record<string, string> = { total: 'new', cumulative: 'weekly', new: 'total', weekly: 'cumulative' }

/**
 * "total" or "cumulative" swapped with "new" or "weekly" in what the figure counts, the first one
 * there; never a "New" that starts a name (New York), and never to a word the evidence uses.
 */
export function cumulativeSwap(f: PlantableFields, rendered: string, evidence: string): FieldPlanted | null {
  const counted = f.counted.trim()
  if (!counted || !lower(rendered).includes(lower(counted))) return null
  for (const m of counted.matchAll(/\b(total|cumulative|new|weekly)\b/gi)) {
    const word = m[0]
    if (word === 'New' && /^\s+\p{Lu}/u.test(counted.slice(m.index + word.length))) continue
    const to = SWAPS[lower(word)]!
    if (new RegExp(`\\b${to}\\b`, 'i').test(evidence)) return null
    const swapped = /^\p{Lu}/u.test(word) ? capitalized(to) : to
    return { fields: { counted: counted.slice(0, m.index) + swapped + counted.slice(m.index + word.length) }, change: `${word} → ${swapped}` }
  }
  return null
}

// ---------------------------------------------------------------------------
// A recorded figure changed, for the figure check (`figureCheck.ts`)
// ---------------------------------------------------------------------------

/** The variants of a recorded figure put to the figure check: the figure as it is, and one planted error per kind. */
export const FIGURE_KINDS = ['faithful', 'wrong-number', 'other-thing'] as const
export type FigureKind = (typeof FIGURE_KINDS)[number]
/** What a correct figure check answers: the figure as it is is given, every planted error is not. */
export const expectedGiven = (kind: FigureKind): boolean => kind === 'faithful'

/** A recorded figure: its value, and its range's upper end where it has one. */
export interface PlantableFigure {
  value: number
  valueHigh: number | null
}

/**
 * The figure times 1.5 at its own precision (its count of decimals), or times 2 where that leaves it
 * unchanged; a range's two ends by the same factor. Null where neither factor changes it, and where
 * the source's words state the planted value or either planted end (`statesValue`), so the variant
 * stays wrong.
 */
export function wrongFigure(f: PlantableFigure, source: string): PlantableFigure | null {
  const times = (v: number, k: number) => Number((v * k).toFixed(decimalsOf(v)))
  for (const k of [1.5, 2]) {
    const planted = { value: times(f.value, k), valueHigh: f.valueHigh === null ? null : times(f.valueHigh, k) }
    if (planted.value === f.value && planted.valueHigh === f.valueHigh) continue
    const stated = [planted.value, planted.valueHigh].some(v => v !== null && statesValue(source, v))
    return stated ? null : planted
  }
  return null
}

/** The decimals a value is written with: 2.25 has two, 2880000 none, 1.5e-7 eight. */
function decimalsOf(v: number): number {
  const [mantissa = '', exponent = '0'] = String(v).toLowerCase().split('e')
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent))
}

/** Each field-level kind whose rule applies, in `FIELD_KINDS` order. */
export function plantFieldVariants(f: PlantableFields, peers: FieldPeers, rendered: string, evidence: string): FieldVariant[] {
  const planted: [FieldKind, FieldPlanted | null][] = [
    ['wrong-place', wrongPlace(f, peers, rendered, evidence)],
    ['wrong-as-of', wrongAsOf(f, evidence)],
    ['wrong-credit', wrongCredit(f, peers, rendered, evidence)],
    ['cumulative-swap', cumulativeSwap(f, rendered, evidence)],
  ]
  return planted.flatMap(([kind, p]) => (p ? [{ kind, ...p }] : []))
}
