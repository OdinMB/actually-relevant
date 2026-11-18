/**
 * The `pass-pool` step (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): production's
 * first research pass (`passInEval`) run in memory on the must entries of the half's developments, so
 * the `stands` and `replay` steps have the evidence production would offer once passes have run on
 * those stories. Its searches end on each story's day, as the `context` step's do; it writes nothing.
 * The resulting pools' usable, structured page facts go to those steps as members' facts, each with
 * an id of its own (a fact a pass found in memory has none). Run 1 only: the pools are the steps'
 * input, not a measure. Stories start only while the budget covers one more first pass.
 */
import type { PassInput } from '../../../services/researchPass.js'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { SearchClient } from '../research/pipeline.js'
import { passInEval } from '../research/pipeline.js'
import { runStories, type SkippedStory } from '../research/storyQueue.js'
import type { SuiteContext } from '../types.js'
import { FIRST_PASS_RESERVE_USD } from './context.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'

export interface PassPoolOptions {
  ctx: SuiteContext
  tavily: SearchClient
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  /** A first pass's input per slug (`loadPassInputsBySlug`, cached), null for a story with none. */
  inputs(slugs: string[]): Promise<Map<string, PassInput | null>>
  relevanceMin: number
  concurrency: number
  budgetUsd: number
  spentUsd: () => number
  limit?: number
}

export interface PassPoolReport {
  stories: number
  /** Stories whose pass gave at least one offerable fact. */
  withFacts: number
  facts: number
  skipped: SkippedStory[]
  left: { what: string; reason: string }[]
  costUsd: number
}

/** A pool's offerable facts as members' facts: page facts only, each with its row id or one made for it. */
export function poolMemberFacts(storyId: string, pool: { sources: MemberFact['source'][]; facts: MemberFact['fact'][] }): MemberFact[] {
  return pool.facts.flatMap(f => {
    const source = pool.sources.find(s => s.ref === f.sourceRef)
    if (!source || source.origin === 'earlier') return []
    return [{ storyId, published: true, fact: { ...f, id: f.id ?? `${storyId}:${f.ref}` }, source }]
  })
}

export async function runPassPool(o: PassPoolOptions): Promise<{ report: PassPoolReport; facts: Map<string, MemberFact[]> }> {
  const keys = o.files.flatMap(f => (f.key && f.errors.length === 0 && inDevelopmentHalf(f.key.id, o.half) ? [f.key] : []))
  const all = [...new Set(keys.flatMap(k => k.entries.filter(e => e.join === 'must').map(e => e.slug)))]
  const slugs = o.limit !== undefined ? all.slice(0, o.limit) : all
  const inputs = await o.inputs(slugs)
  const left = slugs.filter(s => !inputs.get(s)).map(s => ({ what: s, reason: 'no first-pass input: not published here, or no text' }))
  const queued = slugs.flatMap(s => {
    const input = inputs.get(s)
    return input ? [{ id: s, input }] : []
  })
  const before = o.spentUsd()
  const done = await runStories(queued, {
    concurrency: o.concurrency,
    budgetUsd: o.budgetUsd,
    spentUsd: o.spentUsd,
    storyUsd: () => FIRST_PASS_RESERVE_USD,
    run: async ({ input }) => {
      const pass = await passInEval(input, { ctx: o.ctx, tavily: o.tavily, relevanceMin: o.relevanceMin, latestDate: input.storyDay, run: 1 })
      return { storyId: input.story.id, facts: poolMemberFacts(input.story.id, pass.pool) }
    },
  })
  const facts = new Map(done.results.map(r => [r.storyId, r.facts]))
  return {
    facts,
    report: {
      stories: queued.length,
      withFacts: done.results.filter(r => r.facts.length > 0).length,
      facts: done.results.reduce((s, r) => s + r.facts.length, 0),
      skipped: done.skipped,
      left,
      costUsd: o.spentUsd() - before,
    },
  }
}
