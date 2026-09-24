/**
 * Full-assessment suite: stored stories (borderline ratings, non-English and
 * Han-script oversampled) assessed by each arm. Automated gates first; the
 * owner then rates gpt-5-mini against the lowest passing Luna effort.
 */
import { config } from '../../../config.js'
import { buildAssessPrompt } from '../../../prompts/assess.js'
import { assessResultSchema, type AssessResult } from '../../../schemas/llm.js'
import type { AssessItem, Fixtures } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey } from '../models.js'
import {
  ASSESS_FORMAT_CHECKS, checkAssessFormat, findJunk, mean, num, pct, rate, type AssessFormatCheck,
} from '../checks.js'
import { findAssessMetaCommentary } from '../metaCommentary.js'
import { findUnsupportedNumbers } from '../numbers.js'
import { effectiveBar, pickLowestPassing } from '../decide.js'
import type { CallRecord, Decision, RatingItemDraft, Suite } from '../types.js'
import { blockquote, limited, metricRow, parsedOf, runArms, statsFor } from './shared.js'

const BASELINE = arm('gpt-5-mini', 'medium')
const CANDIDATES = [arm('gpt-6-luna', 'medium'), arm('gpt-6-luna', 'high')]
const ARMS = [BASELINE, ...CANDIDATES]
const SCHEMA = 'assess'
export const ASSESS_OUTPUT_TOKENS = 3500
const SPLIT = config.selection.relevanceMin

const items = (fx: Fixtures, limit?: number) => limited(fx.assess, limit)
export const assessPrompt = (s: AssessItem) => buildAssessPrompt(s.title, s.content, s.publisher, s.url, s.guidelines)

interface RatingComparison {
  mad: number | null
  shift: number | null
  splitAgreement: number | null
  n: number
}

export interface AssessArmMetrics {
  ok: number
  format: Record<AssessFormatCheck, number | null>
  /** Ratings against the gpt-5-mini rerun on the same stories. */
  vsBaseline: RatingComparison
  /** Ratings against stored production values (for the baseline: the noise floor). */
  vsStored: RatingComparison
  unsupportedPerOutput: number | null
  unsupported: { storyId: string; numbers: string[] }[]
  junk: string[]
  failures: number
  /** Share of this arm's ratings at or above the selection threshold, and the stored share (information only). */
  atLeastSplit: number | null
  storedAtLeastSplit: number | null
  /** Outputs whose published fields talk about the input ("the article does not quantify…"), with the offending fields. */
  metaCommentary: { storyId: string; fields: string[] }[]
}

function compareRatings(pairs: [number, number][]): RatingComparison {
  return {
    mad: mean(pairs.map(([a, b]) => Math.abs(a - b))),
    shift: mean(pairs.map(([a, b]) => a - b)),
    splitAgreement: rate(pairs.map(([a, b]) => (a >= SPLIT) === (b >= SPLIT))),
    n: pairs.length,
  }
}

const NUMBER_FIELDS = (a: AssessResult) =>
  [a.summary, ...a.factors, ...a.limitingFactors, a.relevanceSummary, a.marketingBlurb].join('\n')

export function scoreAssess(stories: AssessItem[], records: CallRecord<AssessResult>[], baseline: CallRecord<AssessResult>[]): AssessArmMetrics {
  const outputs = stories.map((s, i) => ({ s, a: parsedOf(records[i]), b: parsedOf(baseline[i]) }))
  const ok = outputs.filter((o): o is { s: AssessItem; a: AssessResult; b: AssessResult | null } => o.a != null)
  const checks = ok.map(o => checkAssessFormat(o.a))
  const unsupported = ok.map(o => ({ storyId: o.s.id, numbers: findUnsupportedNumbers(NUMBER_FIELDS(o.a), `${o.s.title}\n${o.s.content}`).unsupported }))
  return {
    ok: ok.length,
    format: Object.fromEntries(ASSESS_FORMAT_CHECKS.map(k => [k, rate(checks.map(c => c[k]))])) as Record<AssessFormatCheck, number | null>,
    vsBaseline: compareRatings(ok.flatMap(o => (o.b ? [[o.a.conservativeRating, o.b.conservativeRating] as [number, number]] : []))),
    vsStored: compareRatings(ok.map(o => [o.a.conservativeRating, o.s.stored.rating] as [number, number])),
    unsupportedPerOutput: mean(unsupported.map(u => u.numbers.length)),
    unsupported: unsupported.filter(u => u.numbers.length > 0),
    junk: ok.flatMap(o => findJunk(o.a)),
    failures: records.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
    atLeastSplit: rate(ok.map(o => o.a.conservativeRating >= SPLIT)),
    storedAtLeastSplit: rate(ok.map(o => o.s.stored.rating >= SPLIT)),
    metaCommentary: ok.map(o => ({ storyId: o.s.id, fields: findAssessMetaCommentary(o.a) })).filter(m => m.fields.length > 0),
  }
}

export function decideAssess(metrics: Record<string, AssessArmMetrics>, baseline: string, candidates: string[]): Decision {
  const b = metrics[baseline]
  // The noise floor is the baseline rerun against stored ratings: a candidate is
  // held to 1.0 MAD, or to the baseline's own MAD when the task is noisier than that.
  const madBar = b.vsStored.mad != null && b.vsStored.mad > 1 ? b.vsStored.mad : 1
  const splitBar = effectiveBar(0.85, b.vsStored.splitAgreement)
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => {
      const m = metrics[c]
      const formatFailures = ASSESS_FORMAT_CHECKS
        .filter(k => (m.format[k] ?? 0) < (b.format[k] ?? 0) - 0.05)
        .map(k => `format ${k} ${pct(m.format[k])} < baseline ${pct(b.format[k])} − 5 pts`)
      const failures = [
        ...formatFailures,
        ...((m.vsBaseline.mad ?? Infinity) > madBar ? [`mean absolute rating difference ${num(m.vsBaseline.mad)} > ${num(madBar)}`] : []),
        ...(Math.abs(m.vsBaseline.shift ?? Infinity) > 0.5 ? [`mean shift ${num(m.vsBaseline.shift)} outside ±0.5`] : []),
        ...((m.vsBaseline.splitAgreement ?? 0) < splitBar ? [`≥${SPLIT} split agreement ${pct(m.vsBaseline.splitAgreement)} < ${pct(splitBar)}`] : []),
        ...((m.unsupportedPerOutput ?? 0) > 1.5 * (b.unsupportedPerOutput ?? 0)
          ? [`unsupported numbers ${num(m.unsupportedPerOutput)}/output > 1.5 × baseline ${num(b.unsupportedPerOutput)}`] : []),
        ...(m.junk.length > 0 ? [`foreign-script junk in ${m.junk.length} fields`] : []),
        ...(m.failures > b.failures ? [`${m.failures} failed calls (baseline ${b.failures})`] : []),
      ]
      return {
        arm: c,
        failures,
        evidence: [
          `vs gpt-5-mini rerun: MAD ${num(m.vsBaseline.mad)}, shift ${num(m.vsBaseline.shift)}, ≥${SPLIT} split agreement ${pct(m.vsBaseline.splitAgreement)} (n=${m.vsBaseline.n})`,
          `noise floor (mini rerun vs stored): MAD ${num(b.vsStored.mad)}, split agreement ${pct(b.vsStored.splitAgreement)}`,
        ],
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Rating items
// ---------------------------------------------------------------------------

export function renderAssessment(a: AssessResult): string {
  return [
    `**${a.titleLabel}** | ${a.relevanceTitle}`,
    '',
    a.summary,
    '',
    blockquote(`"${a.quote}"\n— ${a.quoteAttribution}`),
    '',
    '**Why it matters**',
    ...a.factors,
    '',
    '**Limiting factors**',
    ...a.limitingFactors,
    '',
    '**Rating calculation**',
    ...a.relevanceCalculation,
    '',
    `**Rating ${a.conservativeRating}/10**`,
    '',
    a.relevanceSummary,
    '',
    `*Blurb:* ${a.marketingBlurb}`,
  ].join('\n')
}

function contextFor(s: AssessItem): string {
  return [`**${s.title}**`, `Publisher: ${s.publisher}`, `URL: ${s.url}`, '', 'Article text as the model saw it:', '', blockquote(s.content)].join('\n')
}

interface ArmOutputs {
  arm: string
  /** One record per story, in story order. */
  records: CallRecord<AssessResult>[]
}

/** Full-assessment rating drafts for the stories both arms assessed. */
export function assessRatingDrafts(stories: AssessItem[], baseline: ArmOutputs, candidate: ArmOutputs): RatingItemDraft[] {
  return stories.flatMap((s, i) => {
    const a = parsedOf(baseline.records[i])
    const b = parsedOf(candidate.records[i])
    if (!a || !b) return []
    return [{
      set: 'full-assessment' as const,
      key: s.id,
      context_md: contextFor(s),
      options: [
        { arm: baseline.arm, content_md: renderAssessment(a) },
        { arm: candidate.arm, content_md: renderAssessment(b) },
      ],
      tags: {
        differ: a.conservativeRating !== b.conservativeRating,
        nonEnglish: s.language !== 'en',
        han: s.han,
        band46: s.stored.rating >= 4 && s.stored.rating <= 6,
      },
    }]
  })
}

export const assessSuite: Suite = {
  name: 'assess',
  arms: ARMS,
  describe(fx, limit) {
    const s = items(fx, limit)
    return [
      `assess: ${s.length} stories (target ${TARGETS.assess.total}); ` +
        `${s.filter(x => x.stored.rating >= 4 && x.stored.rating <= 6).length} rated 4-6 (≥${TARGETS.assess.band}), ` +
        `${s.filter(x => x.language !== 'en').length} non-English (≥${TARGETS.assess.nonEnglish}), ` +
        `${s.filter(x => x.han).length} Han-script (≥${TARGETS.assess.han})`,
    ]
  },
  plan(fx, limit) {
    return items(fx, limit).flatMap(s => ARMS.map(a => ({ arm: a, schemaName: SCHEMA, prompt: assessPrompt(s), baseOutputTokens: ASSESS_OUTPUT_TOKENS })))
  },
  async run(fx, ctx) {
    const stories = items(fx, ctx.limit)
    const records = await runArms(ctx, ARMS, stories, SCHEMA, assessResultSchema, assessPrompt)
    const baseRecs = records.get(armKey(BASELINE)) ?? []
    const metrics = Object.fromEntries([...records].map(([k, recs]) => [k, scoreAssess(stories, recs, baseRecs)]))
    const decision = decideAssess(metrics, armKey(BASELINE), CANDIDATES.map(armKey))
    const tasteArm = decision.verdict.kind === 'winner' ? decision.verdict.arm : armKey(arm('gpt-6-luna', 'high'))
    const flagged = CANDIDATES.map(armKey).flatMap(k => (metrics[k]?.unsupported ?? []).map(u => `${k} | story ${u.storyId} | ${u.numbers.join(', ')}`))
    return {
      callSites: [{
        id: 'assess',
        title: 'Full assessment',
        baseline: armKey(BASELINE),
        candidates: CANDIDATES.map(armKey),
        stats: statsFor(records),
        metrics: [
          metricRow('Parsed assessments', metrics, m => m.ok, v => String(v ?? 0), 'higher'),
          ...ASSESS_FORMAT_CHECKS.map(k => metricRow(`Format: ${k}`, metrics, m => m.format[k], pct, 'higher')),
          metricRow('Rating MAD vs gpt-5-mini rerun', metrics, m => m.vsBaseline.mad, v => num(v), 'lower'),
          metricRow('Rating shift vs gpt-5-mini rerun', metrics, m => m.vsBaseline.shift, v => num(v)),
          metricRow(`≥${SPLIT} split agreement vs gpt-5-mini rerun`, metrics, m => m.vsBaseline.splitAgreement, pct, 'higher'),
          metricRow('Rating MAD vs stored', metrics, m => m.vsStored.mad, v => num(v), 'lower'),
          metricRow(`≥${SPLIT} split agreement vs stored`, metrics, m => m.vsStored.splitAgreement, pct, 'higher'),
          metricRow('Rating shift vs stored (calibration)', metrics, m => m.vsStored.shift, v => num(v)),
          metricRow(`Rated ≥${SPLIT} (selection threshold)`, metrics, m => m.atLeastSplit, pct),
          metricRow(`Stored rating ≥${SPLIT} (same stories)`, metrics, m => m.storedAtLeastSplit, pct),
          metricRow('Unsupported numbers per output', metrics, m => m.unsupportedPerOutput, v => num(v), 'lower'),
          metricRow('Outputs with meta-commentary about the input', metrics, m => m.metaCommentary.length, v => String(v ?? 0), 'lower'),
          metricRow('Foreign-script junk fields', metrics, m => m.junk.length, v => String(v ?? 0), 'lower'),
          metricRow('Failed calls', metrics, m => m.failures, v => String(v ?? 0), 'lower'),
        ],
        decision,
        ratingSet: 'full-assessment',
        notes: [
          `Taste set compares ${armKey(BASELINE)} with ${tasteArm}.` +
            (decision.verdict.kind === 'winner' ? '' : ' Neither Luna arm passed the automated gate, so the set shows Luna@high.'),
          `Numbers flagged as absent from the article (for the fabricated-number spot check; the prompt also allows outside knowledge):`,
          ...(flagged.length > 0 ? flagged.map(f => `- ${f}`) : ['- none']),
        ],
      }],
      ratingItems: assessRatingDrafts(stories, { arm: armKey(BASELINE), records: baseRecs }, { arm: tasteArm, records: records.get(tasteArm) ?? [] }),
      notes: [],
    }
  },
}
