/**
 * Pure output-quality and statistics helpers for the model eval.
 */
import type { AssessResult } from '../../schemas/llm.js'
import type { ArmStats, CallOutcome, CallRecord, TokenUsage } from './types.js'

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function countWords(text: string): number {
  return text.split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t)).length
}

export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?…]["'”’)]?)\s+/)
    .map(s => s.trim())
    .filter(s => s !== '')
}

/** Characters outside the Latin, Common and Inherited scripts (outputs are English by contract). */
export function findForeignScript(text: string): string[] {
  return text.match(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu) ?? []
}

/**
 * Foreign-script characters in every string field of a structured output,
 * as `field: chars`. Fields in `skipKeys` echo IDs and are not scanned.
 */
export function findJunk(value: unknown, skipKeys: string[] = [], path = ''): string[] {
  if (typeof value === 'string') {
    const chars = findForeignScript(value)
    return chars.length > 0 ? [`${path || 'value'}: ${[...new Set(chars)].join('')}`] : []
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findJunk(v, skipKeys, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      skipKeys.includes(k) ? [] : findJunk(v, skipKeys, path ? `${path}.${k}` : k),
    )
  }
  return []
}

// ---------------------------------------------------------------------------
// Full-assessment format checks (house format from prompts/assess.ts)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'by', 'at', 'from', 'as', 'is', 'are'])

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w !== '' && !STOPWORDS.has(w)),
  )
}

const between = (n: number, lo: number, hi: number) => n >= lo && n <= hi

export const ASSESS_FORMAT_CHECKS = [
  'factorCount',
  'limitingCount',
  'calculationCount',
  'summaryWords',
  'relevanceSummaryWords',
  'titleWords',
  'titleNoColon',
  'labelWords',
  'labelTitleDistinct',
  'blurbLength',
  'factorFormat',
  'dateFormat',
] as const
export type AssessFormatCheck = (typeof ASSESS_FORMAT_CHECKS)[number]

export function checkAssessFormat(a: AssessResult): Record<AssessFormatCheck, boolean> {
  const labelWords = contentWords(a.titleLabel)
  const titleWords = contentWords(a.relevanceTitle)
  return {
    factorCount: a.factors.length === 4,
    limitingCount: between(a.limitingFactors.length, 1, 4),
    calculationCount: between(a.relevanceCalculation.length, 3, 5),
    summaryWords: between(countWords(a.summary), 40, 70),
    relevanceSummaryWords: between(countWords(a.relevanceSummary), 20, 25),
    titleWords: countWords(a.relevanceTitle) <= 10,
    titleNoColon: !/^[^:]{1,40}:\s/.test(a.relevanceTitle),
    labelWords: between(countWords(a.titleLabel), 1, 3) && !/\band\b/i.test(a.titleLabel),
    labelTitleDistinct: ![...labelWords].some(w => titleWords.has(w)),
    blurbLength: a.marketingBlurb.length <= 230,
    factorFormat: a.factors.every(f => /^-\s\*\*[^*\n]+:\*\*/.test(f.trim())),
    dateFormat: /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(a.publicationDate),
  }
}

// ---------------------------------------------------------------------------
// Social post, newsletter intro and podcast rules (from their prompts)
// ---------------------------------------------------------------------------

export interface SocialPostCheck {
  /** Raw draft longer than the limit, before production's ellipsis trim hides it. */
  overLimit: boolean
  url: boolean
  mention: boolean
  /** Bluesky: any hashtag; Mastodon: more than two. */
  hashtag: boolean
  titleRepeated: boolean
  /** More than one em dash (house rule for user-facing copy). */
  extraEmDash: boolean
  junk: boolean
}

export function checkSocialPost(text: string, rules: { platform: 'bluesky' | 'mastodon'; maxChars: number; title: string }): SocialPostCheck {
  const raw = text.trim()
  const hashtags = raw.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0
  return {
    overLimit: raw.length > rules.maxChars,
    url: /https?:\/\/|www\.|\b[\w-]+\.(?:com|org|net|news|io|gov)\b/i.test(raw),
    mention: /(?:^|\s)@[\w]/.test(raw),
    hashtag: rules.platform === 'bluesky' ? hashtags > 0 : hashtags > 2,
    titleRepeated: rules.title.trim() !== '' && raw.toLowerCase().includes(rules.title.trim().toLowerCase()),
    extraEmDash: (raw.match(/—/g)?.length ?? 0) > 1,
    junk: findForeignScript(raw).length > 0,
  }
}

/** Violations of content the prompt forbids outright (length and em dashes are counted separately). */
export const forbiddenContent = (c: SocialPostCheck) => c.url || c.mention || c.hashtag || c.titleRepeated || c.junk

export interface IntroCheck {
  over60Words: boolean
  sentenceCount: boolean
  bannedPhrase: boolean
  emDash: boolean
  markdown: boolean
}

export function checkIntro(text: string): IntroCheck {
  const sentences = splitSentences(text).length
  return {
    over60Words: countWords(text) >= 60,
    sentenceCount: sentences < 2 || sentences > 3,
    bannedPhrase: /\bthis week\b|\bin this edition\b|\byou\b|\byour\b|\bdear reader\b/i.test(text),
    emDash: text.includes('—'),
    markdown: /[*_#`]|^\s*[-•]\s/m.test(text),
  }
}

export const introViolations = (c: IntroCheck) => Object.values(c).filter(Boolean).length

export interface PodcastCheck {
  longSentenceShare: number | null
  publisherCoverage: number | null
  markup: boolean
}

export function checkPodcast(script: string, publishers: string[]): PodcastCheck {
  const sentences = splitSentences(script.replace(/\n+/g, ' '))
  const distinct = [...new Set(publishers.filter(p => p && p !== 'Unknown'))]
  return {
    longSentenceShare: rate(sentences.map(s => countWords(s) > 12)),
    publisherCoverage: rate(distinct.map(p => script.toLowerCase().includes(p.toLowerCase()))),
    markup: /[*_#`]|\[[^\]]*\]|^\s*(?:intro|outro|section|host)\s*[:\-–]/im.test(script),
  }
}

// ---------------------------------------------------------------------------
// Unsupported numbers
// ---------------------------------------------------------------------------

const SCALE: Record<string, number> = {
  trillion: 1e12, tn: 1e12,
  billion: 1e9, bn: 1e9,
  million: 1e6, mn: 1e6,
  thousand: 1e3,
}

/**
 * A number, optionally with currency, percent or a scale word. Thousands may be
 * grouped with commas, dots, or (French/South African style) a space, no-break
 * space or narrow no-break space: "147 000".
 */
const NUMBER_RE = /(?<![\p{L}\d])([$€£¥]\s?)?(\d{1,3}(?:[   ]\d{3})+(?!\d)|\d[\d,.]*\d|\d)(?:\s*(%)|\s*(percent|per cent|trillion|billion|million|thousand|bn|tn|mn)\b)?/giu
const GROUP_SPACE = /[   ]/g
/** Spelled-out English counts before a scale word: "two million", "a billion". */
const WORD_NUMBER_RE = /\b(a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(trillion|billion|million|thousand)\b/giu
const WORD_VALUES: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

interface NumberToken {
  raw: string
  values: number[]
  /** Carries a currency, percent or scale word, so small values still count. */
  marked: boolean
}

/** Standard reading first; European readings (`4,5` = 4.5, `1.200` = 1200) as alternatives. */
function readNumber(digits: string): number[] {
  const values: number[] = []
  if (/^\d+,\d{1,2}$/.test(digits)) values.push(parseFloat(digits.replace(',', '.')))
  const standard = parseFloat(digits.replace(/,/g, ''))
  if (!Number.isNaN(standard)) values.push(standard)
  if (/^\d{1,3}(\.\d{3})+$/.test(digits)) values.push(parseFloat(digits.replace(/\./g, '')))
  return values
}

function tokenize(text: string): NumberToken[] {
  const tokens: NumberToken[] = []
  for (const m of text.matchAll(NUMBER_RE)) {
    const [raw, currency, digits, percent, scaleWord] = m
    const base = readNumber(digits.replace(GROUP_SPACE, '').replace(/[.,]$/, ''))
    const scale = scaleWord ? SCALE[scaleWord.toLowerCase()] ?? 1 : 1
    const values = scale === 1 ? base : [...base.map(v => v * scale), ...base]
    tokens.push({ raw: raw.trim(), values, marked: Boolean(currency || percent || scaleWord) })
  }
  for (const [raw, word, scaleWord] of text.matchAll(WORD_NUMBER_RE)) {
    const n = WORD_VALUES[word.toLowerCase()]
    tokens.push({ raw, values: [n * SCALE[scaleWord.toLowerCase()], n], marked: true })
  }
  return tokens
}

function matches(value: number, source: number[]): boolean {
  return source.some(s => s === value || (Math.abs(value) >= 10_000 && Math.abs(value - s) / Math.abs(s) <= 0.05))
}

/**
 * Numeric tokens in `output` that do not occur in `source` (after normalising
 * thousands separators, currency, percent and scale words). Bare numbers
 * below 10 are ignored: small counts are usually spelled out in sources.
 */
export function findUnsupportedNumbers(output: string, source: string): { total: number; unsupported: string[] } {
  const sourceValues = tokenize(source).flatMap(t => t.values)
  const considered = tokenize(output).filter(t => t.marked || t.values.some(v => v >= 10))
  const unsupported = considered.filter(t => !t.values.some(v => matches(v, sourceValues))).map(t => t.raw)
  return { total: considered.length, unsupported }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Nearest-rank percentile; null for an empty array. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.max(0, rank - 1)]
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  const union = new Set([...setA, ...setB])
  if (union.size === 0) return 1
  let intersection = 0
  for (const x of setA) if (setB.has(x)) intersection++
  return intersection / union.size
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length
}

/** Share of `true`, or null when there is nothing to measure. */
export function rate(flags: boolean[]): number | null {
  return flags.length === 0 ? null : flags.filter(Boolean).length / flags.length
}

const OUTCOMES: CallOutcome[] = ['ok', 'parse_failure', 'empty', 'truncated', 'error', 'skipped']

export function summarizeCalls(arm: string, records: CallRecord[]): ArmStats {
  const outcomes = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<CallOutcome, number>
  for (const r of records) outcomes[r.outcome]++
  const made = records.filter(r => r.outcome !== 'skipped')
  const returned = made.filter(r => r.outcome !== 'error')
  const meanOf = (pick: (u: TokenUsage) => number) => mean(returned.map(r => pick(r.usage))) ?? 0
  const latencies = returned.map(r => r.latencyMs)
  const total = made.reduce((s, r) => s + r.costUsd, 0)
  return {
    arm,
    calls: made.length,
    outcomes,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    meanUsage: {
      input: meanOf(u => u.input),
      cached: meanOf(u => u.cached),
      output: meanOf(u => u.output),
      reasoning: meanOf(u => u.reasoning),
    },
    meanCostUsd: made.length === 0 ? 0 : total / made.length,
    totalCostUsd: total,
  }
}

/** Failed calls: anything that did not return a parsed result (budget skips excluded). */
export function failureCount(stats: ArmStats): number {
  return stats.calls - stats.outcomes.ok
}

export const pct = (v: number | null | undefined): string => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
export const num = (v: number | null | undefined, digits = 2): string => (v == null ? 'n/a' : v.toFixed(digits))
