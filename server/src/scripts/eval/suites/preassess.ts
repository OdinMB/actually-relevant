/**
 * Pre-assessment suite: batches of 10 stored articles, classified by each arm
 * and compared with the stored gpt-5-mini values. Reclassification and
 * emotion-only tagging run the same classification task, so this suite is
 * also their proxy.
 */
import { config } from '../../../config.js'
import { buildPreassessPrompt } from '../../../prompts/preassess.js'
import { preAssessResultSchema, type PreAssessResult } from '../../../schemas/llm.js'
import type { IssueForPrompt } from '../../../prompts/shared.js'
import type { Fixtures, PreassessItem } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey } from '../models.js'
import { failureCount, findJunk, mean, num, pct, rate } from '../checks.js'
import { effectiveBar, pickLowestPassing } from '../decide.js'
import type { CallRecord, Decision, Suite } from '../types.js'
import { limited, metricRow, parsedOf, runArms, statsFor } from './shared.js'

const BASELINE = arm('gpt-5-mini', 'medium')
const CANDIDATES = [arm('gpt-6-luna', 'medium'), arm('gpt-6-luna', 'low')]
const ARMS = [BASELINE, ...CANDIDATES]
const SCHEMA = 'preassess'
const BASE_OUTPUT_TOKENS = 2500
const GATE = config.assess.fullAssessmentThreshold

function batches(fx: Fixtures, limit?: number): PreassessItem[][] {
  const size = config.preassess.batchSize
  const out: PreassessItem[][] = []
  for (let i = 0; i < fx.preassess.length; i += size) out.push(fx.preassess.slice(i, i + size))
  return limited(out, limit)
}

function promptFor(batch: PreassessItem[], issues: IssueForPrompt[]): string {
  return buildPreassessPrompt(batch.map(s => ({ id: s.id, title: s.title, content: s.content })), issues)
}

export interface PreassessArmMetrics {
  returned: number
  issueAgreement: number | null
  emotionAgreement: number | null
  gateAgreement: number | null
  publishedRecall: number | null
  passRate: number | null
  storedPassRate: number | null
  omitted: number
  unknownIds: number
  invalidSlugs: number
  failures: number
  junk: string[]
  /** Mean (returned − stored) pre-rating: calibration, information only. */
  meanShift: number | null
  /** Pass rate and published-story recall if the gate were one point lower (information only). */
  passRateOneLower: number | null
  publishedRecallOneLower: number | null
}

export function scorePreassess(
  bs: PreassessItem[][],
  records: CallRecord<PreAssessResult>[],
  issues: IssueForPrompt[],
): PreassessArmMetrics {
  const slugs = new Set(issues.map(i => i.slug))
  const pairs: { item: PreassessItem; out: PreAssessResult['articles'][number] }[] = []
  let omitted = 0
  let unknownIds = 0
  const junk: string[] = []
  bs.forEach((batch, i) => {
    const parsed = parsedOf(records[i])
    if (!parsed) return
    const byId = new Map(batch.map(s => [s.id, s]))
    const seen = new Set<string>()
    for (const out of parsed.articles) {
      const item = byId.get(out.articleId)
      if (!item) {
        unknownIds++
        continue
      }
      if (seen.has(item.id)) continue
      seen.add(item.id)
      pairs.push({ item, out })
    }
    omitted += batch.length - seen.size
    junk.push(...findJunk(parsed, ['articleId']))
  })
  const published = pairs.filter(p => p.item.status === 'published')
  return {
    returned: pairs.length,
    issueAgreement: rate(pairs.map(p => p.out.issueSlug === p.item.stored.issueSlug)),
    emotionAgreement: rate(pairs.map(p => p.out.emotionTag === p.item.stored.emotion)),
    gateAgreement: rate(pairs.map(p => (p.out.rating >= GATE) === (p.item.stored.rating >= GATE))),
    publishedRecall: rate(published.map(p => p.out.rating >= GATE)),
    passRate: rate(pairs.map(p => p.out.rating >= GATE)),
    storedPassRate: rate(pairs.map(p => p.item.stored.rating >= GATE)),
    omitted,
    unknownIds,
    invalidSlugs: pairs.filter(p => !slugs.has(p.out.issueSlug)).length,
    failures: records.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
    junk,
    meanShift: mean(pairs.map(p => p.out.rating - p.item.stored.rating)),
    passRateOneLower: rate(pairs.map(p => p.out.rating >= GATE - 1)),
    publishedRecallOneLower: rate(published.map(p => p.out.rating >= GATE - 1)),
  }
}

export function decidePreassess(metrics: Record<string, PreassessArmMetrics>, baseline: string, candidates: string[]): Decision {
  const b = metrics[baseline]
  const bars = {
    issue: effectiveBar(0.85, b.issueAgreement),
    emotion: effectiveBar(0.8, b.emotionAgreement),
    gate: effectiveBar(0.85, b.gateAgreement),
    published: effectiveBar(0.95, b.publishedRecall),
  }
  const atLeast = (label: string, value: number | null, bar: number) =>
    (value ?? 0) >= bar ? [] : [`${label} ${pct(value)} < ${pct(bar)}`]
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => {
      const m = metrics[c]
      const drift = m.passRate != null && m.storedPassRate ? Math.abs(m.passRate - m.storedPassRate) / m.storedPassRate : 0
      return {
        arm: c,
        failures: [
          ...atLeast('issue agreement', m.issueAgreement, bars.issue),
          ...atLeast('emotion agreement', m.emotionAgreement, bars.emotion),
          ...atLeast(`≥${GATE} gate agreement`, m.gateAgreement, bars.gate),
          ...atLeast('published stories passing the gate', m.publishedRecall, bars.published),
          ...(drift > 0.2 ? [`≥${GATE} pass rate ${pct(m.passRate)} is ${pct(drift)} off stored ${pct(m.storedPassRate)}`] : []),
          ...(m.omitted > b.omitted ? [`omitted ${m.omitted} articles (baseline ${b.omitted})`] : []),
          ...(m.failures > b.failures ? [`${m.failures} failed batches (baseline ${b.failures})`] : []),
          ...(m.junk.length > 0 ? [`foreign-script junk in ${m.junk.length} fields`] : []),
        ],
        evidence: [
          `issue ${pct(m.issueAgreement)}, emotion ${pct(m.emotionAgreement)}, gate ${pct(m.gateAgreement)} agreement with stored values`,
          `baseline rerun (noise floor): issue ${pct(b.issueAgreement)}, emotion ${pct(b.emotionAgreement)}, gate ${pct(b.gateAgreement)}`,
        ],
      }
    }),
  )
}

export const preassessSuite: Suite = {
  name: 'preassess',
  arms: ARMS,
  describe(fx, limit) {
    const items = batches(fx, limit).flat()
    return [
      `preassess: ${items.length} stories in ${batches(fx, limit).length} batches (target ${TARGETS.preassess.total}); ` +
        `${items.filter(s => s.han).length} Han-script (≥${TARGETS.preassess.han}), ` +
        `${items.filter(s => s.status === 'published').length} published (≥${TARGETS.preassess.published}), ` +
        `languages ${[...new Set(items.map(s => s.language))].sort().join(', ')}`,
    ]
  },
  plan(fx, limit) {
    return batches(fx, limit).flatMap(b =>
      ARMS.map(a => ({ arm: a, schemaName: SCHEMA, prompt: promptFor(b, fx.issues), baseOutputTokens: BASE_OUTPUT_TOKENS })))
  },
  async run(fx, ctx) {
    const bs = batches(fx, ctx.limit)
    const records = await runArms(ctx, ARMS, bs, SCHEMA, preAssessResultSchema, b => promptFor(b, fx.issues))
    const metrics = Object.fromEntries([...records].map(([k, recs]) => [k, scorePreassess(bs, recs, fx.issues)]))
    const stats = statsFor(records)
    return {
      callSites: [{
        id: 'preassess',
        title: 'Pre-assessment (also the proxy for reclassify and emotion-only tagging)',
        baseline: armKey(BASELINE),
        candidates: CANDIDATES.map(armKey),
        stats,
        metrics: [
          metricRow('Articles returned', metrics, m => m.returned, v => String(v ?? 0)),
          metricRow('Issue agreement with stored', metrics, m => m.issueAgreement, pct, 'higher'),
          metricRow('Emotion agreement with stored', metrics, m => m.emotionAgreement, pct, 'higher'),
          metricRow(`≥${GATE} gate agreement with stored`, metrics, m => m.gateAgreement, pct, 'higher'),
          metricRow('Published stories passing the gate', metrics, m => m.publishedRecall, pct, 'higher'),
          metricRow(`≥${GATE} pass rate`, metrics, m => m.passRate, pct),
          metricRow(`Stored ≥${GATE} pass rate (same stories)`, metrics, m => m.storedPassRate, pct),
          metricRow('Mean pre-rating shift vs stored (calibration)', metrics, m => m.meanShift, v => num(v)),
          metricRow(`≥${GATE - 1} pass rate (gate one point lower)`, metrics, m => m.passRateOneLower, pct),
          metricRow(`Published stories passing at ≥${GATE - 1}`, metrics, m => m.publishedRecallOneLower, pct),
          metricRow('Omitted articles', metrics, m => m.omitted, v => String(v ?? 0), 'lower'),
          metricRow('Unknown article IDs', metrics, m => m.unknownIds, v => String(v ?? 0), 'lower'),
          metricRow('Invalid issue slugs', metrics, m => m.invalidSlugs, v => String(v ?? 0), 'lower'),
          metricRow('Failed batches', metrics, m => m.failures, v => String(v ?? 0), 'lower'),
          metricRow('Foreign-script junk fields', metrics, m => m.junk.length, v => String(v ?? 0), 'lower'),
        ],
        decision: decidePreassess(metrics, armKey(BASELINE), CANDIDATES.map(armKey)),
        notes: [
          `Stored values are what production wrote (gpt-5-mini, plus any admin edits or reclassify runs); the gpt-5-mini rerun against them is the noise floor.`,
          ...stats.filter(s => failureCount(s) > 0).map(s => `${s.arm}: ${failureCount(s)} batch calls did not return a parsed result.`),
        ],
      }],
      ratingItems: [],
      notes: [],
    }
  },
}
