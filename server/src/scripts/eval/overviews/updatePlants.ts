/**
 * The `update` step's planted corrections (`updateFixtures.ts`; `.context/model-eval.md`, "`update`"):
 * a fact contradicting one the story cites in a way no newer value can explain, built on `plant.ts`'s
 * changes, each checked for sense before it is planted.
 *
 * - `wrong-number`: one count of the old fact's statement changed (×1.5, or ×2) for the same moment,
 *   that moment stated in the planted statement where it was not. The judge's fact brief carries a
 *   fact's source and day but no as-of (production's `researchPassLater.ts`), so the statement is where
 *   it can see that the two give values for one moment; a different count of a rising figure from a
 *   later report would otherwise read as a newer value, which supersedes by the judge's own rule.
 * - `wrong-year`: the year of an event moved back by one, which the old year rules out. Never a year
 *   after the story's (a forecast or a plan, which a newer report may revise) nor one that dates a
 *   figure (another year's figure is no contradiction, by the same rule).
 *
 * The sanity check refuses a change that would make nonsense rather than a wrong fact: a day of the
 * month ("March 22" to "March 33"), a share pushed above 100%, a bound of a range or a span ("2015–16"
 * to "2015–24"). And the planted fact's source words are the old fact's sentence with the same change,
 * so the wire source holds a sentence and a statement of its own, as a real one does; a number its
 * sentence does not state is refused. Pure.
 */
import { significant } from '../../../lib/numbers.js'
import { isYear, plantableNumbers, timesNumber, wrongNumbers, wrongYears, type NumberChange, type PlantableNumber } from './plant.js'

export const CORRECTION_KINDS = ['wrong-number', 'wrong-year'] as const
export type CorrectionKind = (typeof CORRECTION_KINDS)[number]

/** Why a change was not planted, in the order the checks run. */
export const REFUSAL_REASONS = {
  day: 'a day of the month: the change would give a date (March 33), not a wrong count',
  share: 'a share pushed above 100%',
  range: 'a bound of a range or a span (2015–16): the change would alter what it spans',
  forecast: "a year after the story's: a forecast or a plan, which a newer report may revise",
  period: "a year that dates a figure: another year's figure is no contradiction",
  sentence: 'its source words do not state it, so the planted source would hold the planted text alone',
} as const
export type RefusalReason = keyof typeof REFUSAL_REASONS

/** The cited fact a correction is planted on. */
export interface CitedFact {
  statement: string
  /** Its source's words that state it. */
  sentence: string
  /** The moment it gives a value for, `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: its as-of, else its source's day. */
  moment: string
}

export interface Correction {
  /** The planted fact's statement: the old one with one change, the moment stated where it was not. */
  statement: string
  /** Its source words: the old fact's sentence with the same change. */
  sentence: string
  /** The change, as `4,000 → 6,000`. */
  change: string
  /** The value the change replaced: a section stating it states what the correction makes wrong. */
  replaced: number
}

export interface Refused {
  change: string
  reason: RefusalReason
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MONTH_BEFORE = new RegExp(`\\b${MONTH}\\.?\\s+$`, 'i')
const MONTH_AFTER = new RegExp(`^\\s+(?:of\\s+)?${MONTH}\\b`, 'i')
const RANGE_BEFORE = /(?:\d\s*[-–—/]\s*|\d\s+(?:to|and)\s+)$/i
const RANGE_AFTER = /^(?:\s*[-–—/]\s*|\s+(?:to|and)\s+)[$€£¥]?\d/i
const PERCENT = /(%|percent|per cent)$/i

const isDay = (text: string, n: PlantableNumber) => MONTH_BEFORE.test(text.slice(0, n.start)) || MONTH_AFTER.test(text.slice(n.end))
const inRange = (text: string, n: PlantableNumber) => RANGE_BEFORE.test(text.slice(0, n.start)) || RANGE_AFTER.test(text.slice(n.end))
const primary = (raw: string) => plantableNumbers(raw)[0]?.token.values[0] ?? NaN

/** What makes a changed number nonsense rather than a wrong count: a day, a share above 100%, a range's bound. */
function numberRefusal(text: string, n: PlantableNumber, insert: string): RefusalReason | null {
  if (isDay(text, n)) return 'day'
  if (PERCENT.test(n.raw) && primary(insert) > 100 && (n.token.values[0] ?? 0) <= 100) return 'share'
  if (inRange(text, n)) return 'range'
  return null
}

/** What keeps a moved year from being a contradiction: a range's bound, a forecast, a figure it dates. */
function yearRefusal(text: string, n: PlantableNumber, storyYear: number): RefusalReason | null {
  if (inRange(text, n)) return 'range'
  if (Number(n.raw) > storyYear) return 'forecast'
  const figure = plantableNumbers(text).some(m => m.start !== n.start && significant(m.token) && !isYear(m) && !isDay(text, m))
  return figure ? 'period' : null
}

type Checked = { sentence: string } | { refused: RefusalReason }

/** The sentence with the statement's change made to its own rendering of the number, or why it cannot be. */
function changedSentence(kind: CorrectionKind, sentence: string, c: NumberChange & { factor?: number }): Checked {
  const same = plantableNumbers(sentence).find(m =>
    kind === 'wrong-year' ? isYear(m) && m.raw === c.at.raw : significant(m.token) && !isYear(m) && m.token.values.some(v => c.at.token.values.includes(v)),
  )
  if (!same) return { refused: 'sentence' }
  const insert = kind === 'wrong-year' ? c.insert : c.factor === undefined ? null : timesNumber(same.raw, c.factor)
  if (insert === null) return { refused: 'sentence' }
  const refused = kind === 'wrong-year' ? (inRange(sentence, same) ? 'range' : null) : numberRefusal(sentence, same, insert)
  return refused ? { refused } : { sentence: sentence.slice(0, same.start) + insert + sentence.slice(same.end) }
}

const MOMENT = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

/** A moment in words at its own precision: `July 2, 2026`, `July 2026`, `2026`; null when it is no such date. */
export function momentWords(moment: string): string | null {
  const m = MOMENT.exec(moment)
  if (!m) return null
  const [, year, month, day] = m
  if (month === undefined) return year!
  const name = MONTH_NAMES[Number(month) - 1]
  if (!name) return null
  return day === undefined ? `${name} ${year}` : `${name} ${Number(day)}, ${year}`
}

/** Whether a text already names the moment: its year; its month and year; or its month and day. */
function statesMoment(text: string, moment: string): boolean {
  const m = MOMENT.exec(moment)
  if (!m) return false
  const [, year, month, day] = m
  if (month === undefined) return text.includes(year!)
  const name = MONTH_NAMES[Number(month) - 1] ?? ''
  if (day === undefined) return text.includes(year!) && new RegExp(`\\b${name}\\b`, 'i').test(text)
  const d = Number(day)
  return new RegExp(`\\b${name}\\s+${d}\\b|\\b${d}\\s+${name}\\b`, 'i').test(text) || text.includes(moment)
}

/** The statement with its moment: ", as of July 20, 2026." appended where it names none. */
function withMoment(text: string, moment: string): string {
  const words = momentWords(moment)
  if (!words || statesMoment(text, moment)) return text
  return `${text.replace(/[\s.]+$/, '')}, as of ${words}.`
}

/**
 * Every correction of `kind` the fact allows, in its statement's text order, each with its change
 * refused or planted. `storyDay` (`YYYY-MM-DD`) dates the story: a year after its year is a forecast.
 */
export function plantCorrections(kind: CorrectionKind, fact: CitedFact, storyDay: string): { planted: Correction[]; refused: Refused[] } {
  const planted: Correction[] = []
  const refused: Refused[] = []
  const storyYear = Number(storyDay.slice(0, 4))
  const changes: (NumberChange & { factor?: number })[] = kind === 'wrong-year' ? wrongYears(fact.statement) : wrongNumbers(fact.statement)
  for (const c of changes) {
    const refusal = kind === 'wrong-year' ? yearRefusal(fact.statement, c.at, storyYear) : numberRefusal(fact.statement, c.at, c.insert)
    const checked: Checked = refusal ? { refused: refusal } : changedSentence(kind, fact.sentence, c)
    if ('refused' in checked) {
      refused.push({ change: c.change, reason: checked.refused })
      continue
    }
    planted.push({
      statement: kind === 'wrong-year' ? c.text : withMoment(c.text, fact.moment),
      sentence: checked.sentence,
      change: c.change,
      replaced: kind === 'wrong-year' ? Number(c.at.raw) : (c.at.token.values[0] ?? NaN),
    })
  }
  return { planted, refused }
}
