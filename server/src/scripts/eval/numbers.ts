/**
 * Reading numbers in model output and source text, and checking that an
 * output's numbers occur in its source. Pure.
 */

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

export interface NumberToken {
  raw: string
  values: number[]
  /** Carries a currency, percent or scale word, so small values still count. */
  marked: boolean
  /** Offset of the token in the text it was read from. */
  index: number
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

export function readNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = []
  for (const m of text.matchAll(NUMBER_RE)) {
    const [raw, currency, digits, percent, scaleWord] = m
    const base = readNumber(digits.replace(GROUP_SPACE, '').replace(/[.,]$/, ''))
    const scale = scaleWord ? SCALE[scaleWord.toLowerCase()] ?? 1 : 1
    const values = scale === 1 ? base : [...base.map(v => v * scale), ...base]
    tokens.push({ raw: raw.trim(), values, marked: Boolean(currency || percent || scaleWord), index: m.index ?? 0 })
  }
  for (const m of text.matchAll(WORD_NUMBER_RE)) {
    const [raw, word, scaleWord] = m
    const n = WORD_VALUES[word.toLowerCase()]
    tokens.push({ raw, values: [n * SCALE[scaleWord.toLowerCase()], n], marked: true, index: m.index ?? 0 })
  }
  return tokens
}

/** Numbers worth checking: anything with a unit or scale, and bare numbers from 10 up (small counts are usually spelled out). */
export const significant = (t: NumberToken) => t.marked || t.values.some(v => v >= 10)

/** A token whose value occurs among `source` values; large numbers may be rounded by up to 5%. */
export function occursIn(t: NumberToken, source: number[]): boolean {
  return t.values.some(value => source.some(s => s === value || (Math.abs(value) >= 10_000 && Math.abs(value - s) / Math.abs(s) <= 0.05)))
}

/**
 * Numeric tokens in `output` that do not occur in `source` (after normalising
 * thousands separators, currency, percent and scale words). Bare numbers
 * below 10 are ignored: small counts are usually spelled out in sources.
 */
export function findUnsupportedNumbers(output: string, source: string): { total: number; unsupported: string[] } {
  const sourceValues = readNumbers(source).flatMap(t => t.values)
  const considered = readNumbers(output).filter(significant)
  const unsupported = considered.filter(t => !occursIn(t, sourceValues)).map(t => t.raw)
  return { total: considered.length, unsupported }
}
