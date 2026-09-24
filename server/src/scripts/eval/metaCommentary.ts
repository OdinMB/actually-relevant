/**
 * Published text that talks about the model's input instead of the
 * development: "the article does not quantify…", "the supplied excerpt". The
 * site shows these fields as written, so the owner's target is none. Pure.
 */
import type { AssessResult } from '../../schemas/llm.js'

/**
 * "the article", "this excerpt"; a number after "article" is a legal article
 * ("Article 5"). "passage" and "report" are left out: "the passage of the
 * bill" and "the report finds" are about the world, not the input.
 */
const META_PATTERNS = [
  /\b(?:the|this|that)\s+(?:article(?!\s+\d)|excerpt|extract|snippet|input)\b/gi,
  /\b(?:supplied|provided)\s+(?:article|excerpt|extract|snippet|text|input)\b/gi,
  /\b(?:article|excerpt|text|piece|input|source)\s+(?:does not|doesn't|did not|didn't|do not|don't)\s+(?:say|state|specify|quantify|mention|give|provide|detail|explain|include|name|disclose|report|clarify|indicate|address|describe)\b/gi,
  /\btruncated\b/gi,
]

/** Phrases in `text` that refer to the input itself, in reading order. */
export function findMetaCommentary(text: string): string[] {
  return META_PATTERNS
    .flatMap(re => [...text.matchAll(re)].map(m => ({ at: m.index ?? 0, phrase: m[0] })))
    .sort((a, b) => a.at - b.at)
    .map(m => m.phrase)
}

/** Every field the site publishes as written; the quote is verbatim source text, so it is not scanned. */
function publishedFields(a: AssessResult): [string, string][] {
  const list = (name: string, items: string[]) => items.map((t, i): [string, string] => [`${name}[${i}]`, t])
  return [
    ['summary', a.summary],
    ...list('factors', a.factors),
    ...list('limitingFactors', a.limitingFactors),
    ...list('relevanceCalculation', a.relevanceCalculation),
    ['relevanceSummary', a.relevanceSummary],
    ['titleLabel', a.titleLabel],
    ['relevanceTitle', a.relevanceTitle],
    ['marketingBlurb', a.marketingBlurb],
  ]
}

/** One `field: "first phrase"` entry per published field that talks about the input. */
export function findAssessMetaCommentary(a: AssessResult): string[] {
  return publishedFields(a).flatMap(([field, text]) => {
    const [first] = findMetaCommentary(text)
    return first ? [`${field}: "${first}"`] : []
  })
}
