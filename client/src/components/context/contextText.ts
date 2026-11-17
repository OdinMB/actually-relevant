import type { ContextBoxType, ContextChartView } from '@shared/types'

/**
 * The fixed words of story context on the page (`.context/public-website.md`, "Story context"): the
 * kicker naming each card's slot, the as-of date and a chart's caption.
 * None of it is AI-written: the cards' own headings, teasers and sentences are.
 */

const KICKERS: Record<ContextBoxType, string> = {
  compared: 'Compared with what',
  why_now: 'Why now',
  build_up: 'The long build-up',
  who_affected: 'Who it reaches',
  response: 'What’s being done',
  next: 'What comes next',
  key_term: 'Key term',
}

/** The kicker over a card, naming its slot. */
export const slotKicker = (type: ContextBoxType): string => KICKERS[type]

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH = /^(\d{4})-(\d{2})$/
const YEAR = /^\d{4}$/

const format = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })

/**
 * A fact date as precise as it was given: "Nov 13, 2026" for a day, "November 2026" for a month,
 * "2026" for a year; null without one or for a date it can't read.
 */
export function asOfText(asOf: string | null): string | null {
  if (!asOf) return null
  if (DAY.test(asOf)) return format(asOf, { month: 'short', day: 'numeric', year: 'numeric' })
  if (MONTH.test(asOf)) return format(`${asOf}-01`, { month: 'long', year: 'numeric' })
  return YEAR.test(asOf) ? asOf : null
}

/** A card's footer date: "As of Nov 13, 2026"; null without one. */
export function asOfLine(asOf: string | null): string | null {
  const text = asOfText(asOf)
  return text ? `As of ${text}` : null
}

/**
 * A chart's visible caption, which also names it: the measure with a capital, and its unit after a
 * comma when the unit is a word the measure doesn't already name ("Area burned in Indonesia,
 * hectares"; "Average attendance in pilot schools" for a `%`, which every value shows).
 */
export function chartCaption(chart: Pick<ContextChartView, 'caption' | 'unit'>): string {
  const measure = chart.caption.charAt(0).toUpperCase() + chart.caption.slice(1)
  const unit = chart.unit.trim()
  const wordUnit = /^[a-z][a-z\s-]*$/i.test(unit)
  return wordUnit && !chart.caption.toLowerCase().includes(unit.toLowerCase()) ? `${measure}, ${unit}` : measure
}
