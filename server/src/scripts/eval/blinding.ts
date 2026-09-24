/**
 * Model-name blinding for the owner's rating sets.
 *
 * Owner decision (2026-09-24): no rating item may show a model name anywhere,
 * its context included. A story whose text mentions a GPT/OpenAI model name
 * is left out of the rating items instead of being shown: single-story items
 * are dropped at build time, and multi-story fixtures (selection groups,
 * newsletters, the podcast) drop the story before any prompt is built, so no
 * arm ever sees it.
 */
import { MODELS } from './models.js'

/** Matched as whole words, so "solar", "lunar" and "nanotechnology" do not hit. */
const WORD_TERMS = [...Object.keys(MODELS), 'Luna', 'Sol', 'nano']
/** Matched at a word start only, so "GPT4o", "GPT-5" and "OpenAI's" hit but "Egypt" does not. */
const PREFIX_TERMS = ['gpt', 'ChatGPT', 'OpenAI']

export const BLIND_TERMS: string[] = [...WORD_TERMS, ...PREFIX_TERMS]

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const PATTERNS: { term: string; re: RegExp }[] = [
  ...WORD_TERMS.map(term => ({
    term,
    re: new RegExp(`(?<![A-Za-z0-9_])${escape(term)}${/\w$/.test(term) ? '(?![A-Za-z0-9_])' : ''}`, 'i'),
  })),
  ...PREFIX_TERMS.map(term => ({ term, re: new RegExp(`(?<![A-Za-z0-9_])${escape(term)}`, 'i') })),
]

/** Model names and family words in `text` (case-insensitive), as the terms that matched. */
export function findModelNames(text: string): string[] {
  return PATTERNS.filter(p => p.re.test(text)).map(p => p.term)
}

export function mentionsModelName(value: unknown): boolean {
  return findModelNames(typeof value === 'string' ? value : JSON.stringify(value) ?? '').length > 0
}

/** How often each term matched across `values`, e.g. "OpenAI ×2, gpt ×1" (for the report). */
export function tallyTerms(values: unknown[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    for (const t of findModelNames(typeof v === 'string' ? v : JSON.stringify(v) ?? '')) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([t, n]) => `${t} ×${n}`).join(', ')
}

/**
 * Split `stories` into those safe to show a rater and those mentioning a
 * model name in any field a prompt or rating context would carry.
 */
export function withoutModelNames<T>(stories: T[]): { kept: T[]; removed: T[] } {
  const kept: T[] = []
  const removed: T[] = []
  for (const s of stories) (mentionsModelName(s) ? removed : kept).push(s)
  return { kept, removed }
}
