/**
 * Related-stories re-rank suite: the production prompt over the 12 nearest
 * published stories. Calls run one at a time so latency is measured without
 * contention (this call sits on a public page request).
 */
import { config } from '../../../config.js'
import { buildRelatedStoriesPrompt } from '../../../prompts/related-stories.js'
import { relatedStoriesResultSchema, type RelatedStoriesResult } from '../../../schemas/llm.js'
import type { Fixtures, RelatedItem } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey } from '../models.js'
import { mean, pct, rate } from '../checks.js'
import { pickLowestPassing } from '../decide.js'
import type { CallRecord, Decision, Suite } from '../types.js'
import { limited, metricRow, parsedOf, runArmsSequentially, statsFor } from './shared.js'

const BASELINE = arm('gpt-5-nano', 'medium')
const CANDIDATES = [arm('gpt-6-luna', 'low'), arm('gpt-6-luna', 'medium')]
const ARMS = [BASELINE, ...CANDIDATES]
const SCHEMA = 'related'
const BASE_OUTPUT_TOKENS = 1500
const SHOW = config.relatedStories.displayCount

const items = (fx: Fixtures, limit?: number) => limited(fx.related, limit)
const promptFor = (r: RelatedItem) => buildRelatedStoriesPrompt(r.source, r.candidates, SHOW)

/** Valid, unique picks in order (what production keeps before slicing to 4). */
export function validPicks(result: RelatedStoriesResult | null, candidateIds: string[]): { picks: string[]; invalid: number } {
  if (!result) return { picks: [], invalid: 0 }
  const allowed = new Set(candidateIds)
  const picks = [...new Set(result.selectedIds.filter(id => allowed.has(id)))]
  return { picks, invalid: result.selectedIds.filter(id => !allowed.has(id)).length }
}

export interface RelatedArmMetrics {
  exactCompliance: number | null
  overlapWithBaseline: number | null
  failures: number
}

export function scoreRelated(stories: RelatedItem[], records: CallRecord<RelatedStoriesResult>[], baseline: CallRecord<RelatedStoriesResult>[]): RelatedArmMetrics {
  const exact: boolean[] = []
  const overlap: number[] = []
  stories.forEach((s, i) => {
    const ids = s.candidates.map(c => c.id)
    const mine = validPicks(parsedOf(records[i]), ids)
    const parsed = parsedOf(records[i])
    exact.push(parsed != null && mine.invalid === 0 && mine.picks.length === SHOW && parsed.selectedIds.length === SHOW)
    const base = validPicks(parsedOf(baseline[i]), ids).picks.slice(0, SHOW)
    if (parsed && base.length > 0) {
      const top = new Set(mine.picks.slice(0, SHOW))
      overlap.push(base.filter(id => top.has(id)).length / SHOW)
    }
  })
  return {
    exactCompliance: rate(exact),
    overlapWithBaseline: mean(overlap),
    failures: records.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
  }
}

export function decideRelated(metrics: Record<string, RelatedArmMetrics>, baseline: string, candidates: string[]): Decision {
  const b = metrics[baseline]
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => {
      const m = metrics[c]
      return {
        arm: c,
        failures: [
          ...((m.exactCompliance ?? 0) < (b.exactCompliance ?? 0) ? [`exact-${SHOW} compliance ${pct(m.exactCompliance)} < nano ${pct(b.exactCompliance)}`] : []),
          ...((m.overlapWithBaseline ?? 0) < 0.5 ? [`mean overlap with nano's picks ${pct(m.overlapWithBaseline)} < 50%`] : []),
        ],
        evidence: [`exact-${SHOW} ${pct(m.exactCompliance)} (nano ${pct(b.exactCompliance)}), overlap with nano ${pct(m.overlapWithBaseline)}`],
      }
    }),
  )
}

export const relatedSuite: Suite = {
  name: 'related',
  arms: ARMS,
  describe(fx, limit) {
    return [`related: ${items(fx, limit).length} published stories with ${SHOW * config.relatedStories.candidateMultiplier} candidates each (target ${TARGETS.related.total})`]
  },
  plan(fx, limit) {
    return items(fx, limit).flatMap(r => ARMS.map(a => ({ arm: a, schemaName: SCHEMA, prompt: promptFor(r), baseOutputTokens: BASE_OUTPUT_TOKENS })))
  },
  async run(fx, ctx) {
    const stories = items(fx, ctx.limit)
    const records = await runArmsSequentially(ctx, ARMS, stories, SCHEMA, relatedStoriesResultSchema, promptFor)
    const base = records.get(armKey(BASELINE)) ?? []
    const metrics = Object.fromEntries([...records].map(([k, recs]) => [k, scoreRelated(stories, recs, base)]))
    return {
      callSites: [{
        id: 'related',
        title: 'Related-stories re-rank',
        baseline: armKey(BASELINE),
        candidates: CANDIDATES.map(armKey),
        stats: statsFor(records),
        metrics: [
          metricRow(`Exactly ${SHOW} valid, unique IDs`, metrics, m => m.exactCompliance, pct, 'higher'),
          metricRow("Mean overlap with nano's picks", metrics, m => m.overlapWithBaseline, pct),
          metricRow('Failed calls', metrics, m => m.failures, v => String(v ?? 0), 'lower'),
        ],
        decision: decideRelated(metrics, armKey(BASELINE), CANDIDATES.map(armKey)),
        notes: ['Latency is measured with one call in flight at a time; production adds the shared LLM_DELAY_MS queue on top.'],
      }],
      ratingItems: [],
      notes: [],
    }
  },
}
