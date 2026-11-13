/**
 * What the own-words checks found across eval:research's runs (`.context/story-research.md`,
 * "Own words"): first-draft problems by cause, the rewrites they caused, the items dropped from
 * kept drafts, the `draft_failed_check` fallbacks by the causes of the item they failed on, the
 * longest runs of shared words per kind, and the fact check's input per call. The shadow week
 * counts the same things in SQL. Pure.
 */
import type { CitationProblem, CopiedFrom } from '../../../services/researchChecks.js'
import type { StoryResearch } from './pipeline.js'

export const PROBLEM_CAUSES = [
  'fact: code',
  'fact: judge',
  'copying: code, wording',
  'copying: code, statement',
  'copying: code, quoted span',
  'copying: judge, close rendering',
  'copying: judge, follows a source',
] as const
export type ProblemCause = (typeof PROBLEM_CAUSES)[number]

export function causeOf(p: CitationProblem): ProblemCause {
  if (p.kind === 'fact') return p.by === 'code' ? 'fact: code' : 'fact: judge'
  if (p.by === 'judge') return p.copiedSentence ? 'copying: judge, close rendering' : 'copying: judge, follows a source'
  if (p.against === 'wording') return 'copying: code, wording'
  return p.against === 'statement' ? 'copying: code, statement' : 'copying: code, quoted span'
}

export interface CauseCounts {
  /** Problems in the first draft. */
  firstDraftFlags: number
  /** Runs rewritten with a first-draft problem of this cause. */
  rewrites: number
  /** Items still failing after the rewrite in a draft that was kept, so dropped from it. */
  dropped: number
  /** `draft_failed_check` fallbacks whose failing item had a problem of this cause. */
  fallbacks: number
}

export interface RunLengths {
  /** First-draft items with a recorded run of this kind. */
  items: number
  max: number
  atLeast8: number
  atLeast12: number
}

export interface OwnWords {
  byCause: Record<ProblemCause, CauseCounts>
  runLengths: Record<CopiedFrom, RunLengths>
  factCheckInput: { calls: number; mean: number; max: number }
}

const causes = (problems: CitationProblem[]) => new Set(problems.map(causeOf))

/** The causes of each failing item: an item with problems of two causes counts once under each. */
function causesByItem(problems: CitationProblem[]): Set<ProblemCause>[] {
  const byLabel = new Map<string, CitationProblem[]>()
  for (const p of problems) byLabel.set(p.label, [...(byLabel.get(p.label) ?? []), p])
  return [...byLabel.values()].map(causes)
}

function runLengths(results: StoryResearch[], against: CopiedFrom): RunLengths {
  const longest = results.flatMap(r => {
    const byItem = new Map<string, number>()
    for (const run of r.checks[0]?.longestRuns ?? []) if (run.against === against) byItem.set(run.label, Math.max(byItem.get(run.label) ?? 0, run.words))
    return [...byItem.values()]
  })
  return {
    items: longest.length,
    max: longest.length === 0 ? 0 : Math.max(...longest),
    atLeast8: longest.filter(w => w >= 8).length,
    atLeast12: longest.filter(w => w >= 12).length,
  }
}

export function ownWords(results: StoryResearch[]): OwnWords {
  const byCause = Object.fromEntries(PROBLEM_CAUSES.map(c => [c, { firstDraftFlags: 0, rewrites: 0, dropped: 0, fallbacks: 0 }])) as Record<
    ProblemCause,
    CauseCounts
  >
  for (const r of results) {
    const first = r.checks[0]?.problems ?? []
    for (const p of first) byCause[causeOf(p)].firstDraftFlags++
    if (r.rewritten) for (const c of causes(first)) byCause[c].rewrites++
    const v = r.verdict
    if (v.kind !== 'fallback') for (const item of causesByItem(r.problems)) for (const c of item) byCause[c].dropped++
    else if (v.category === 'draft_failed_check' && r.failedOn) for (const c of causes(r.problems.filter(p => p.label === r.failedOn))) byCause[c].fallbacks++
  }
  const inputs = results.flatMap(r => r.calls.filter(c => c.step === 'fact-check').map(c => c.usage.input))
  return {
    byCause,
    runLengths: { wording: runLengths(results, 'wording'), statement: runLengths(results, 'statement') },
    factCheckInput: {
      calls: inputs.length,
      mean: inputs.length === 0 ? 0 : inputs.reduce((a, b) => a + b, 0) / inputs.length,
      max: inputs.length === 0 ? 0 : Math.max(...inputs),
    },
  }
}

const share = (part: number, whole: number) => (whole === 0 ? `${part}` : `${part} (${Math.round((part / whole) * 100)}%)`)

/** The report's "Own words" section, below its heading. */
export function ownWordsLines(results: StoryResearch[]): string[] {
  const w = ownWords(results)
  return [
    'First-draft problems by cause, the rewrites they caused, the items still failing after the rewrite (dropped from a kept draft) and the `draft_failed_check` fallbacks whose failing item they caused. A run or an item with problems of several causes counts under each. `code` is the deterministic check, `judge` the fact-check model.',
    '',
    '| Cause | First-draft flags | Rewrites | Items dropped | Fallbacks |',
    '|---|---|---|---|---|',
    ...PROBLEM_CAUSES.map(c => {
      const n = w.byCause[c]
      return `| ${c} | ${n.firstDraftFlags} | ${n.rewrites} | ${n.dropped} | ${n.fallbacks} |`
    }),
    '',
    "Each first-draft item's longest run of words shared with one outside source, per kind (the code flags 12 or more):",
    '',
    '| Shared with | Items | Longest | 8+ words | 12+ words |',
    '|---|---|---|---|---|',
    ...(['wording', 'statement'] as const).map(k => {
      const l = w.runLengths[k]
      return `| ${k} | ${l.items} | ${l.max} | ${share(l.atLeast8, l.items)} | ${share(l.atLeast12, l.items)} |`
    }),
  ]
}
