/**
 * Story context's pure rules for what a fact may show (`.context/story-context.md`, "Validity",
 * "Tiles" and "Charts"): whether a fact is current on the story's day, how its number is written,
 * which values a tile shows (the tile rule, ADR-0063) and whether a chart may be drawn (the chart
 * rules, ADR-0064). Every date is a `YYYY-MM-DD` day, or an as-of of `YYYY-MM` or `YYYY`.
 */
import { fieldText } from '../schemas/factFields.js'
import type { Approx, CreditedKind, StoredChart, StoredPoint, Validity } from '../schemas/storyContext.js'

/** What the rules read of a fact. */
export interface VisualFact {
  ref: string
  value: number | null
  valueHigh: number | null
  unit: string
  approx: Approx
  provisional: boolean
  /** `YYYY-MM-DD`, `YYYY-MM` or `YYYY`; null when the source dates the fact only by its publication. */
  asOf: string | null
  /** The source's publication day; null when unknown. */
  sourceDate: string | null
  validity: Validity
  /** The credited body's kind; null when nobody is credited. */
  creditedKind: CreditedKind | null
  /** The source's kind (`SOURCE_KINDS`). */
  sourceKind: string
  /** Supported by its check and not demoted: only such a fact is ever offered or shown. */
  shown: boolean
}

export interface ValidityWindows {
  fastDays: number
  slowDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000
/** A chart point this close to the story's day takes the area's color. */
export const RECENT_DAYS = 30

const AS_OF = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

/** A model's as-of answer as a valid `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, else null (an empty or unreadable answer). */
export function normalizeAsOf(value: string | null | undefined): string | null {
  const m = AS_OF.exec((value ?? '').trim())
  if (!m) return null
  const [, y, mo, d] = m
  if (mo !== undefined && (Number(mo) < 1 || Number(mo) > 12)) return null
  if (d !== undefined) {
    const t = new Date(`${y}-${mo}-${d}T00:00:00Z`)
    if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null
  }
  return m[0]
}

export type AsOfPrecision = 'day' | 'month' | 'year'

export const precisionOf = (asOf: string): AsOfPrecision => (asOf.length === 10 ? 'day' : asOf.length === 7 ? 'month' : 'year')

/** The first day of an as-of's period: `2026` gives `2026-01-01`. */
export function periodStart(asOf: string): string {
  return asOf.length === 4 ? `${asOf}-01-01` : asOf.length === 7 ? `${asOf}-01` : asOf
}

/**
 * An as-of no later than its source's publication day, else null: a source cannot date a state or
 * event after it was published, so a later as-of is a forecast or a deadline the model wrote in, and
 * the fact falls back to its source's day (`factDate`). The two are compared at the as-of's own
 * precision, so `2026-11` and `2026` hold the day `2026-11-24` and are kept. Without a source day the
 * as-of is kept as given.
 */
export function pastAsOf(asOf: string | null, sourceDay: string | null): string | null {
  if (asOf === null || sourceDay === null) return asOf
  return asOf > sourceDay.slice(0, asOf.length) ? null : asOf
}

/** An as-of as the database keeps it: the period's first day and its precision. */
export function asOfColumns(asOf: string | null): { date: Date | null; precision: AsOfPrecision | null } {
  return asOf === null ? { date: null, precision: null } : { date: new Date(`${periodStart(asOf)}T00:00:00Z`), precision: precisionOf(asOf) }
}

/** The as-of back from its columns. */
export function asOfFromColumns(date: Date | null, precision: string | null): string | null {
  if (!date) return null
  const day = date.toISOString().slice(0, 10)
  return precision === 'year' ? day.slice(0, 4) : precision === 'month' ? day.slice(0, 7) : day
}

/** The date a fact describes: its as-of, else its source's day; null without either. */
export const factDate = (f: Pick<VisualFact, 'asOf' | 'sourceDate'>): string | null => f.asOf ?? f.sourceDate

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS

/**
 * Whether a fact is current on `onDay`, the story's own day (never today): a `fixed` fact always is;
 * a `slow` or `fast` one for its window from the start of its as-of period (the source's day when it
 * has none), so a coarse as-of counts from its earliest day. Without any date it is not.
 */
export function isCurrent(f: Pick<VisualFact, 'validity' | 'asOf' | 'sourceDate'>, onDay: string, windows: ValidityWindows): boolean {
  if (f.validity === 'fixed') return true
  const date = factDate(f)
  if (date === null) return false
  return daysBetween(periodStart(date), onDay) <= (f.validity === 'fast' ? windows.fastDays : windows.slowDays)
}

/** The first day a fact current today is no longer (`isCurrent`); null for a `fixed` one, which always is, or one with no date, which never is. */
export function currentUntil(f: Pick<VisualFact, 'validity' | 'asOf' | 'sourceDate'>, windows: ValidityWindows): string | null {
  const date = factDate(f)
  if (f.validity === 'fixed' || date === null) return null
  const days = (f.validity === 'fast' ? windows.fastDays : windows.slowDays) + 1
  return new Date(Date.parse(`${periodStart(date)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

const trimmed = (n: number) => String(Number(n.toFixed(2)))

function compact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${trimmed(v / 1e9)}bn`
  if (abs >= 1e6) return `${trimmed(v / 1e6)}m`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** A number in words a fact check reads: "2.88 million", "1.2 billion", "400,000". */
export function spelledNumber(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${trimmed(v / 1e9)} billion`
  if (abs >= 1e6) return `${trimmed(v / 1e6)} million`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const PREFIX_UNITS: Record<string, string> = { usd: '$', us$: '$', $: '$', eur: '€', '€': '€', gbp: '£', '£': '£' }
const SUFFIX_UNITS = new Set(['%', '°c', '°f'])

/**
 * A unit as the formatters read it: what one of the value is (`base`) and, for a rate, the period
 * after it (`rate`: " per year"; empty otherwise). The fields' schema has a rate keep its period in
 * its unit ("USD per year", `schemas/factFields.ts`), and the symbol is the base's.
 */
function unitParts(unit: string): { base: string; rate: string } {
  const u = unit.trim()
  const at = u.toLowerCase().indexOf(' per ')
  return at < 0 ? { base: u, rate: '' } : { base: u.slice(0, at).trim(), rate: u.slice(at) }
}

const prefixOf = (base: string) => (Object.hasOwn(PREFIX_UNITS, base.toLowerCase()) ? PREFIX_UNITS[base.toLowerCase()] : undefined)

const isSymbol = (base: string) => prefixOf(base) !== undefined || SUFFIX_UNITS.has(base.toLowerCase())

/**
 * A number with its unit where the unit, or a rate's unit before its period, is a symbol ("$1.2bn",
 * "63%"); other units and a rate's period are the label's, so the number goes alone.
 */
function withSymbol(n: string, unit: string): string {
  const { base } = unitParts(unit)
  const prefix = prefixOf(base)
  if (prefix !== undefined) return `${prefix}${n}`
  if (SUFFIX_UNITS.has(base.toLowerCase())) return `${n}${base}`
  return n
}

type Figure = Pick<VisualFact, 'value' | 'valueHigh' | 'unit' | 'approx' | 'provisional'>

/**
 * A fact's number as readers see it: "12.5m", "400,000+", "about 2.9m", "under 5,000", a range
 * "5,000–5,400", a symbol unit kept ("$1.2bn", "63%"); `estimate` for a provisional figure. Null for a
 * fact without one.
 */
export function formatFigure(f: Figure): { text: string; estimate: boolean } | null {
  if (f.value === null) return null
  const low = withSymbol(compact(f.value), f.unit)
  const n = f.valueHigh !== null && f.valueHigh !== f.value ? `${low}–${withSymbol(compact(f.valueHigh), f.unit)}` : low
  const text = f.approx === 'about' ? `about ${n}` : f.approx === 'at_least' ? `${n}+` : f.approx === 'under' ? `under ${n}` : n
  return { text, estimate: f.provisional }
}

/**
 * A fact's number in words for the checks, with its qualifier and unit: "about 2.88 million hectares",
 * "at least 63%", a rate with its period, "$52 million per year". Null without one. A unit that is
 * only a filler ("none", stored before 2026-11-24) is left out (`fieldText`).
 */
export function spelledFigure(f: Figure): string | null {
  if (f.value === null) return null
  const unit = fieldText(f.unit)
  const { base, rate } = unitParts(unit)
  const symbol = isSymbol(base)
  const one = (v: number) => (symbol ? withSymbol(spelledNumber(v), unit) : spelledNumber(v))
  const n = f.valueHigh !== null && f.valueHigh !== f.value ? `${one(f.value)} to ${one(f.valueHigh)}` : one(f.value)
  const qualifier = f.approx === 'about' ? 'about ' : f.approx === 'at_least' ? 'at least ' : f.approx === 'under' ? 'under ' : ''
  return `${qualifier}${n}${symbol ? rate : unit ? ` ${unit}` : ''}`
}

/** Most authoritative first: a tile's headline comes from the first kind present. */
const AUTHORITY: CreditedKind[] = ['official', 'research', 'news', 'other']

const SOURCE_KIND_CREDIT: Record<string, CreditedKind> = {
  'official-body': 'official',
  'news-report': 'news',
  analysis: 'news',
  opinion: 'news',
  'press-release': 'other',
}

/** A fact's authority: the credited body's kind, else its source's. */
export const authorityOf = (f: Pick<VisualFact, 'creditedKind' | 'sourceKind'>): CreditedKind => f.creditedKind ?? SOURCE_KIND_CREDIT[f.sourceKind] ?? 'other'

export interface TileValue {
  ref: string
  text: string
  estimate: boolean
}

const sameValue = (a: VisualFact, b: VisualFact) =>
  a.value === b.value && a.valueHigh === b.valueHigh && a.unit.trim().toLowerCase() === b.unit.trim().toLowerCase()

/**
 * What a tile shows (the tile rule): of its shown, current facts with a figure, the headline is the
 * newest from the most authoritative kind present (official, research, news, other); every other
 * such fact dated on or after it with a different value is shown beside it, each value once and
 * naming its own source; a value the headline already gives is not repeated. Empty when none is current.
 */
export function tileDisplay(facts: VisualFact[], onDay: string, windows: ValidityWindows): TileValue[] {
  const current = facts.filter(f => f.shown && f.value !== null && isCurrent(f, onDay, windows))
  if (current.length === 0) return []
  const rank = (f: VisualFact) => AUTHORITY.indexOf(authorityOf(f))
  const best = Math.min(...current.map(rank))
  const dateOf = (f: VisualFact) => periodStart(factDate(f) ?? '0000')
  const headline = current.filter(f => rank(f) === best).sort((a, b) => dateOf(b).localeCompare(dateOf(a)))[0]!
  const beside: VisualFact[] = []
  for (const f of current) {
    if (f === headline || dateOf(f) < dateOf(headline)) continue
    if (sameValue(f, headline) || beside.some(b => sameValue(b, f))) continue
    beside.push(f)
  }
  return [headline, ...beside].map(f => ({ ref: f.ref, ...formatFigure(f)! }))
}

export interface ChartPoint {
  label: string
  ref: string
  value: number
  text: string
  /** Provisional: drawn hatched. */
  estimate: boolean
  /** Within 30 days of the story's day: drawn in the area's color. */
  recent: boolean
  /** The date the point describes. */
  asOf: string | null
}

export interface ChartDisplay {
  kind: 'bars' | 'line'
  measure: string
  unit: string
  points: ChartPoint[]
  /** A different measure shown beside a comparison, never in it: drawn lighter. */
  apart: { measure: string; unit: string; points: ChartPoint[] } | null
}

/** The points whose facts may be drawn: shown, with a single value (a range is no point). */
function drawable(points: StoredPoint[], facts: ReadonlyMap<string, VisualFact>, storyDay: string): ChartPoint[] {
  return points.flatMap(p => {
    const f = facts.get(p.factId)
    if (!f || !f.shown || f.value === null || f.valueHigh !== null) return []
    const date = factDate(f)
    return [
      {
        label: p.label,
        ref: f.ref,
        value: f.value,
        text: formatFigure(f)!.text,
        estimate: f.provisional,
        recent: date !== null && Math.abs(daysBetween(periodStart(date), storyDay)) <= RECENT_DAYS,
        asOf: date,
      },
    ]
  })
}

/** One unit across the points (the facts' own, compared without case), none negative: the axis starts at zero. */
function oneUnit(points: ChartPoint[], facts: ReadonlyMap<string, VisualFact>): string | null {
  const units = new Set(points.map(p => facts.get(p.ref)!.unit.trim().toLowerCase()))
  if (units.size !== 1 || points.some(p => p.value < 0)) return null
  return facts.get(points[0]!.ref)!.unit.trim()
}

/**
 * Whether a chart may be drawn (the chart rules), and what it draws: every point a shown fact with a
 * single value (others are removed before counting), one unit, no negative value (the axis starts at
 * zero); bars need 2 points, a line 3 at different dates, drawn in date order. An `apart` group is
 * kept beside bars when it holds a point of one unit of its own. Null: the chart is not drawn.
 */
export function validChart(spec: StoredChart, facts: ReadonlyMap<string, VisualFact>, storyDay: string): ChartDisplay | null {
  let points = drawable(spec.points, facts, storyDay)
  if (spec.kind === 'bars' && points.length < 2) return null
  if (spec.kind === 'line') {
    const dates = points.map(p => p.asOf)
    if (points.length < 3 || dates.includes(null) || new Set(dates).size !== dates.length) return null
    points = [...points].sort((a, b) => periodStart(a.asOf!).localeCompare(periodStart(b.asOf!)))
  }
  const unit = oneUnit(points, facts)
  if (unit === null) return null
  let apart: ChartDisplay['apart'] = null
  if (spec.kind === 'bars' && spec.apart) {
    const apartPoints = drawable(spec.apart.points, facts, storyDay)
    const apartUnit = apartPoints.length > 0 ? oneUnit(apartPoints, facts) : null
    if (apartUnit !== null) apart = { measure: spec.apart.measure, unit: apartUnit, points: apartPoints }
  }
  return { kind: spec.kind, measure: spec.measure, unit, points, apart }
}
