/**
 * The steps eval:recalibrate runs. Each check sends the current (recalibrated)
 * prompt to gpt-6-luna only and scores it with the suites' own scorers against
 * the owner's acceptance rules (recalibration.ts): ratings against the stored
 * production values, dedup against phase 1's labelled set. The rating-set step
 * regenerates the full-assessment blind-rating set as v2.
 *
 * Calls use versioned schema names (models.ts), so tuning a Zod description is
 * never answered from the cache of the previous wording.
 */
import type { z } from 'zod'
import { config, type ReasoningEffort } from '../../config.js'
import { assessResultSchema, dedupConfirmationSchema, preAssessResultSchema, type PreAssessResult } from '../../schemas/llm.js'
import { num, pct, summarizeCalls } from './checks.js'
import type { Fixtures, PreassessItem } from './fixtures.js'
import { repeatDetails, runNumbers, runSchemaName } from './repeats.js'
import { arm, armKey, versionedSchemaName } from './models.js'
import type { RecalibrationOptions, RecalibrationStep } from './options.js'
import { replaceRatingSetFiles } from './ratingFiles.js'
import {
  assessCriteria,
  dedupCounts,
  dedupCriteria,
  dedupMistakes,
  preassessCriteria,
  type Criterion,
  type DedupPair,
  type RecalibrationSample,
} from './recalibration.js'
import { VOLUMES } from './resultsReport.js'
import { ASSESS_OUTPUT_TOKENS, assessPrompt, assessRatingDrafts, scoreAssess } from './suites/assess.js'
import { DEDUP_BASELINE, DEDUP_OUTPUT_TOKENS, dedupPrompt, labelDedupSets, phase1DedupPrompt, votesFrom } from './suites/dedup.js'
import { PREASSESS_OUTPUT_TOKENS, batchStories, preassessPrompt, scorePreassess } from './suites/preassess.js'
import { limited, parsedOf, runArms } from './suites/shared.js'
import type { Arm, ArmStats, CallRecord, CallSiteId, PlannedCall, SuiteContext } from './types.js'

const PREASSESS_SCHEMA = versionedSchemaName('preassess', preAssessResultSchema)
const ASSESS_SCHEMA = versionedSchemaName('assess', assessResultSchema)
const DEDUP_SCHEMA = versionedSchemaName('dedup', dedupConfirmationSchema)
const MINI = arm('gpt-5-mini', 'medium')
const luna = (effort: ReasoningEffort) => arm('gpt-6-luna', effort)
/** Owner's decision: the regenerated full-assessment set is `actually-relevant-full-assessment-v2`. */
export const RATING_SET_VERSION = 2
const GATE = config.assess.fullAssessmentThreshold
const SPLIT = config.selection.relevanceMin

export interface StepInput {
  fx: Fixtures
  /** The half (or whole) of the folder's sample the checks run on. */
  sample: RecalibrationSample
  opts: RecalibrationOptions
  /** The folder holds the 2026-09-24 phase-1 sample (freshSample.ts), whose ledger has phase 1's reference answers. */
  phase1Sample: boolean
}

export interface StepSection {
  title: string
  arm: string
  sample: string
  /** Empty for the rating-set step, which throws when the written deliverable fails validation. */
  criteria: Criterion[]
  details: string[]
  stats: ArmStats[]
  /** Monthly cost at inventory volumes for the tested arm; null when the step is not a production call site. */
  monthly: { low: number; high: number } | null
}

export interface RecalibrationStepDef {
  name: RecalibrationStep
  /**
   * Set when the step reads reference data that only the phase-1 folder holds;
   * the reason is printed and the step skipped on any other sample.
   */
  phase1Only?: string
  plan(input: StepInput): PlannedCall[]
  /** A free check run before anything is paid for (dry runs included); throws when the step cannot run. */
  preflight?(input: StepInput, phase1: SuiteContext): Promise<string>
  /** `phase1` is a cache-only context: the labelled dedup set is read from the ledger, never paid for again. */
  run(input: StepInput, ctx: SuiteContext, phase1: SuiteContext): Promise<StepSection>
}

export function monthlyAt(site: CallSiteId, stats: ArmStats): { low: number; high: number } {
  return { low: stats.meanCostUsd * VOLUMES[site].low, high: stats.meanCostUsd * VOLUMES[site].high }
}

/** One arm over every item. */
export async function runOne<I, T>(
  ctx: SuiteContext,
  a: Arm,
  items: I[],
  schemaName: string,
  schema: z.ZodType<T>,
  prompt: (i: I) => string,
): Promise<CallRecord<T>[]> {
  return (await runArms(ctx, [a], items, schemaName, schema, prompt)).get(armKey(a)) ?? []
}

const pairLines = (label: string, pairs: DedupPair[]) =>
  pairs.length === 0 ? [`${label}: none`] : [`${label}:`, ...pairs.map(p => `- "${p.source}" / "${p.candidate}"`)]

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const preassessBatches = ({ sample, opts }: StepInput) => limited(batchStories(sample.preassess), opts.limit)

/** Every run's schema name: run 1 keeps the plain one, so earlier ledger entries answer it. */
const runSchemas = (schemaName: string, { opts }: StepInput) => runNumbers(opts.repeat).map(r => runSchemaName(schemaName, r))
const repeatNote = ({ opts }: StepInput) => (opts.repeat > 1 ? `; ${opts.repeat} runs each, criteria on all runs pooled` : '')

/** One run's pre-assessment answers per story, in the batches' story order. */
function preassessAnswers(bs: PreassessItem[][], records: CallRecord<PreAssessResult>[]) {
  const byId = new Map<string, PreAssessResult['articles'][number]>()
  bs.forEach((_, i) => {
    for (const a of parsedOf(records[i])?.articles ?? []) if (!byId.has(a.articleId)) byId.set(a.articleId, a)
  })
  return bs.flat().map(s => byId.get(s.id) ?? null)
}

const preassessStep: RecalibrationStepDef = {
  name: 'preassess',
  plan: input =>
    runSchemas(PREASSESS_SCHEMA, input).flatMap(schemaName =>
      preassessBatches(input).map(b => ({
        arm: luna(input.opts.effort),
        schemaName,
        prompt: preassessPrompt(b, input.fx.issues),
        baseOutputTokens: PREASSESS_OUTPUT_TOKENS,
      })),
    ),
  async run(input, ctx) {
    const a = luna(input.opts.effort)
    const bs = preassessBatches(input)
    const runs = await Promise.all(
      runSchemas(PREASSESS_SCHEMA, input).map(schemaName => runOne(ctx, a, bs, schemaName, preAssessResultSchema, b => preassessPrompt(b, input.fx.issues))),
    )
    // Pooled over runs: each run's batches count as further batches, so every rate is the runs' average.
    const m = scorePreassess(
      runs.flatMap(() => bs),
      runs.flat(),
      input.fx.issues,
    )
    const stats = summarizeCalls(armKey(a), runs.flat())
    const answers = runs.map(recs => preassessAnswers(bs, recs))
    const repeat =
      runs.length > 1
        ? repeatDetails({
            runs: runs.map(recs => {
              const r = scorePreassess(bs, recs, input.fx.issues)
              return { ok: r.returned, shift: r.meanShift, share: r.passRate }
            }),
            ratings: answers.map(run => run.map(x => x?.rating ?? null)),
            threshold: GATE,
            categories: [
              { name: 'Issue', perRun: answers.map(run => run.map(x => x?.issueSlug ?? null)) },
              { name: 'Emotion', perRun: answers.map(run => run.map(x => x?.emotionTag ?? null)) },
            ],
          })
        : []
    return {
      title: 'Pre-assessment',
      arm: armKey(a),
      sample: `${bs.flat().length} stories in ${bs.length} batches, ${bs.flat().filter(s => s.status === 'published').length} published${repeatNote(input)}`,
      criteria: preassessCriteria(m, { phase1Sample: input.phase1Sample }),
      details: [
        `≥${GATE} gate agreement with stored ${pct(m.gateAgreement)}; share ≥${GATE - 1} ${pct(m.passRateOneLower)}, published passing at ≥${GATE - 1} ${pct(m.publishedRecallOneLower)}.`,
        `Returned ${m.returned}; omitted ${m.omitted}, unknown IDs ${m.unknownIds}, invalid slugs ${m.invalidSlugs}, failed batches ${m.failures}, foreign-script junk ${m.junk.length}.`,
        ...(repeat.length > 0 ? ['', ...repeat] : []),
      ],
      stats: [stats],
      monthly: monthlyAt('preassess', stats),
    }
  },
}

const assessStories = ({ sample, opts }: StepInput) => limited(sample.assess, opts.limit)

const assessStep: RecalibrationStepDef = {
  name: 'assess',
  plan: input =>
    runSchemas(ASSESS_SCHEMA, input).flatMap(schemaName =>
      assessStories(input).map(s => ({
        arm: luna(input.opts.effort),
        schemaName,
        prompt: assessPrompt(s),
        baseOutputTokens: ASSESS_OUTPUT_TOKENS,
      })),
    ),
  async run(input, ctx) {
    const a = luna(input.opts.effort)
    const stories = assessStories(input)
    const runs = await Promise.all(runSchemas(ASSESS_SCHEMA, input).map(schemaName => runOne(ctx, a, stories, schemaName, assessResultSchema, assessPrompt)))
    // Pooled over runs: each run's outputs count as further stories, so every rate is the runs' average.
    const m = scoreAssess(
      runs.flatMap(() => stories),
      runs.flat(),
      [],
    )
    const stats = summarizeCalls(armKey(a), runs.flat())
    const repeat =
      runs.length > 1
        ? repeatDetails({
            runs: runs.map(recs => {
              const r = scoreAssess(stories, recs, [])
              return { ok: r.ok, shift: r.vsStored.shift, share: r.atLeastSplit }
            }),
            ratings: runs.map(recs => stories.map((_, i) => parsedOf(recs[i])?.conservativeRating ?? null)),
            threshold: SPLIT,
          })
        : []
    return {
      title: 'Full assessment',
      arm: armKey(a),
      sample: `${stories.length} stories, ${stories.filter(s => s.language !== 'en').length} non-English${repeatNote(input)}`,
      criteria: assessCriteria(m),
      details: [
        `Rating MAD vs stored ${num(m.vsStored.mad)}; ≥${SPLIT} split agreement with stored ${pct(m.vsStored.splitAgreement)} (n=${m.vsStored.n}).`,
        `Parsed ${m.ok}; failed calls ${m.failures}; unsupported numbers per output ${num(m.unsupportedPerOutput)}; foreign-script junk ${m.junk.length}.`,
        ...m.unsupported.map(u => `- unsupported numbers, story ${u.storyId}: ${u.numbers.join(', ')}`),
        ...m.metaCommentary.map(x => `- meta-commentary, story ${x.storyId}: ${x.fields.join('; ')}`),
        ...(repeat.length > 0 ? ['', ...repeat] : []),
      ],
      stats: [stats],
      monthly: monthlyAt('assess', stats),
    }
  },
}

const dedupSets = ({ sample, opts }: StepInput) => limited(sample.dedup, opts.limit)

const dedupStep: RecalibrationStepDef = {
  name: 'dedup',
  phase1Only: "its labelled pairs and gpt-5-nano's verdicts on them are phase 1's, read from that folder's ledger",
  plan: input =>
    dedupSets(input).map(s => ({
      arm: luna(input.opts.dedupEffort),
      schemaName: DEDUP_SCHEMA,
      prompt: dedupPrompt(s),
      baseOutputTokens: DEDUP_OUTPUT_TOKENS,
    })),
  async preflight(input, phase1) {
    const labels = (await labelDedupSets(phase1, dedupSets(input), phase1DedupPrompt)).labels.flat()
    return `phase 1's labelled set read from the ledger: ${labels.filter(l => l === 'dup').length} duplicate and ${labels.filter(l => l === 'not').length} distinct pairs`
  },
  async run(input, ctx, phase1) {
    const a = luna(input.opts.dedupEffort)
    const sets = dedupSets(input)
    const labelled = await labelDedupSets(phase1, sets, phase1DedupPrompt)
    const nanoVotes = (labelled.perArm.get(armKey(DEDUP_BASELINE)) ?? []).map(v => v.votes)
    const records = await runOne(ctx, a, sets, DEDUP_SCHEMA, dedupConfirmationSchema, dedupPrompt)
    const votes = sets.map((set, s) => votesFrom(parsedOf(records[s]), set.candidates.length).votes)
    const mistakes = dedupMistakes(sets, votes, labelled.labels)
    const contested = labelled.labels.flat().filter(l => l === 'contested').length
    const stats = summarizeCalls(armKey(a), records)
    return {
      title: 'Dedup confirmation',
      arm: armKey(a),
      sample: `${sets.length} sets, ${labelled.labels.flat().length} pairs (phase 1's labels, read from the ledger; ${contested} contested pairs left out)`,
      criteria: dedupCriteria(dedupCounts(votes, labelled.labels), dedupCounts(nanoVotes, labelled.labels)),
      details: [...pairLines('Wrong merges', mistakes.wrongMerges), '', ...pairLines('Missed duplicates', mistakes.missed)],
      stats: [stats],
      monthly: monthlyAt('dedup', stats),
    }
  },
}

/** Every story of the phase-1 sample (not a half): the set is for taste, not calibration. */
const ratingSetArms = (effort: ReasoningEffort): [Arm, Arm] => [MINI, luna(effort)]

const ratingSetStep: RecalibrationStepDef = {
  name: 'rating-set',
  phase1Only: "it swaps a set in the owner's phase-1 rating deliverable",
  plan: ({ fx, opts }) =>
    fx.assess.flatMap(s =>
      ratingSetArms(opts.effort).map(a => ({
        arm: a,
        schemaName: ASSESS_SCHEMA,
        prompt: assessPrompt(s),
        baseOutputTokens: ASSESS_OUTPUT_TOKENS,
      })),
    ),
  async run({ fx, opts }, ctx) {
    const [base, cand] = ratingSetArms(opts.effort)
    const records = await runArms(ctx, [base, cand], fx.assess, ASSESS_SCHEMA, assessResultSchema, assessPrompt)
    const drafts = assessRatingDrafts(
      fx.assess,
      { arm: armKey(base), records: records.get(armKey(base)) ?? [] },
      { arm: armKey(cand), records: records.get(armKey(cand)) ?? [] },
    )
    const written = replaceRatingSetFiles(opts.out, 'full-assessment', RATING_SET_VERSION, drafts)
    if (written.validationErrors.length > 0) throw new Error(`the rewritten deliverable failed validation: ${written.validationErrors.join('; ')}`)
    return {
      title: 'Full-assessment rating set',
      arm: `${armKey(base)} vs ${armKey(cand)}, both on the recalibrated prompt`,
      sample: `${fx.assess.length} stories drafted, ${drafts.length} with both outputs parsed`,
      criteria: [],
      details: [
        `Wrote \`${written.set.id}\` with ${written.set.items} items in place of the previous full-assessment set.`,
        ...written.excluded.map(e => `- left out ${e.key}: the ${e.where === 'context' ? 'story' : 'output'} names ${e.terms.join(', ')}`),
      ],
      stats: [...records.entries()].map(([k, recs]) => summarizeCalls(k, recs)),
      monthly: null,
    }
  },
}

/** The recalibration's own steps. The phase-2 ship checks live in shipChecks.ts; recalibrate.ts joins both. */
export const RECALIBRATION_STEP_DEFS = {
  preassess: preassessStep,
  assess: assessStep,
  dedup: dedupStep,
  'rating-set': ratingSetStep,
} satisfies Partial<Record<RecalibrationStep, RecalibrationStepDef>>
