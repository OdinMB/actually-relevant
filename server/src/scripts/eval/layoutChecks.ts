/**
 * eval:recalibrate steps for the two prompts the house order (2026-11-18, `.context/prompting.md`,
 * "House order") changed that no other check runs, each on its production tier as a constant arm,
 * over the whole cached sample (the calibration halves belong to the rating recalibration):
 * - `reclassify`: reclassification (small tier) on the pre-assessment batches, scored against the
 *   stored issue and emotion tag as the preassess step scores pre-assessment. The format bars gate;
 *   the agreement is read beside the preassess step's on the same sample.
 * - `uplifting-select`: the Actually Uplifting issue's selection (large tier) on each cached
 *   newsletter longlist at the issue's size; selection's gate (exactly N valid, unique ids).
 * Calls use versioned schema names, as the other steps' do.
 */
import { config } from '../../config.js'
import type { IssueForPrompt } from '../../prompts/shared.js'
import { buildReclassifyPrompt } from '../../prompts/reclassify.js'
import type { StoryForNewsletterSelect } from '../../prompts/newsletter-select.js'
import { buildUpliftingSelectPrompt } from '../../prompts/uplifting-select.js'
import { newsletterSelectResultSchema, reclassifyResultSchema } from '../../schemas/llm.js'
import { pct, rate, summarizeCalls } from './checks.js'
import type { NewsletterItem, PreassessItem } from './fixtures.js'
import { arm, armKey, versionedSchemaName } from './models.js'
import type { RecalibrationStep } from './options.js'
import { PHASE1_PREASSESS, type Criterion } from './recalibration.js'
import { runOne, type RecalibrationStepDef, type StepInput } from './recalibrationChecks.js'
import { batchStories, PREASSESS_OUTPUT_TOKENS } from './suites/preassess.js'
import { limited, parsedOf } from './suites/shared.js'
import type { CallRecord } from './types.js'

/** Production's small tier, as research's adapter holds it. */
const SMALL = arm('gpt-6-luna', 'low')
/** Production's large tier (`config.newsletter.selectModelTier`), as the large-tier suite's candidate. */
const LARGE = arm('gpt-6.1-sol', 'medium')
const RECLASSIFY_SCHEMA = versionedSchemaName('reclassify', reclassifyResultSchema)
const UPLIFTING_SCHEMA = versionedSchemaName('uplifting-select', newsletterSelectResultSchema)
/** About twice a selection's measured output, for the budget gate. */
const SELECT_OUTPUT_TOKENS = 1100

const zero = (name: string, n: number): Criterion => ({ name, value: String(n), bar: '0', pass: n === 0, required: true })

// ---------------------------------------------------------------------------
// Reclassification
// ---------------------------------------------------------------------------

type Reclassified = { articles: { articleId: string; issueSlug: string; emotionTag: string }[] }

const reclassifyBatches = ({ fx, opts }: StepInput) => limited(batchStories(fx.preassess), opts.limit)

/** Production's prompt on a batch, as `reclassifyStories` builds it. */
export const reclassifyPrompt = (issues: IssueForPrompt[]) => (batch: PreassessItem[]) =>
  buildReclassifyPrompt(
    batch.map(s => ({ id: s.id, title: s.title, content: s.content })),
    issues,
  )

export interface ReclassifyMetrics {
  stories: number
  omitted: number
  unknownIds: number
  invalidSlugs: number
  failures: number
  issueAgreement: number | null
  emotionAgreement: number | null
}

/** Each batch's answer against its stories' stored issue and emotion tag; a story answered twice counts once. */
export function scoreReclassify(bs: PreassessItem[][], records: CallRecord<Reclassified>[], issues: IssueForPrompt[]): ReclassifyMetrics {
  const slugs = new Set(issues.map(i => i.slug))
  const issue: boolean[] = []
  const emotion: boolean[] = []
  let omitted = 0
  let unknownIds = 0
  let invalidSlugs = 0
  let failures = 0
  bs.forEach((batch, i) => {
    const parsed = parsedOf(records[i])
    if (!parsed) {
      if (records[i]?.outcome !== 'skipped') failures++
      return
    }
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
      if (!slugs.has(out.issueSlug)) invalidSlugs++
      issue.push(out.issueSlug === item.stored.issueSlug)
      emotion.push(out.emotionTag === item.stored.emotion)
    }
    omitted += batch.length - seen.size
  })
  return {
    stories: bs.reduce((n, b) => n + b.length, 0),
    omitted,
    unknownIds,
    invalidSlugs,
    failures,
    issueAgreement: rate(issue),
    emotionAgreement: rate(emotion),
  }
}

/** The format bars gate; the agreement is reported against phase 1's pre-assessment, not required (another prompt's numbers). */
export function reclassifyCriteria(m: ReclassifyMetrics): Criterion[] {
  const reported = (name: string, value: number | null, reference: number): Criterion => ({
    name,
    value: pct(value),
    bar: `${pct(reference)} (phase 1's pre-assessment; read beside the preassess step's on this sample)`,
    pass: value != null && value >= reference,
    required: false,
  })
  return [
    zero('Stories left out of their batch', m.omitted),
    zero('Unknown article ids returned', m.unknownIds),
    zero('Issue slugs not in the list', m.invalidSlugs),
    zero('Failed calls', m.failures),
    reported('Issue agreement with stored', m.issueAgreement, PHASE1_PREASSESS.issueAgreement),
    reported('Emotion agreement with stored', m.emotionAgreement, PHASE1_PREASSESS.emotionAgreement),
  ]
}

const reclassifyStep: RecalibrationStepDef = {
  name: 'reclassify',
  plan: input =>
    reclassifyBatches(input).map(b => ({
      arm: SMALL,
      schemaName: RECLASSIFY_SCHEMA,
      prompt: reclassifyPrompt(input.fx.issues)(b),
      baseOutputTokens: PREASSESS_OUTPUT_TOKENS,
    })),
  async run(input, ctx) {
    const bs = reclassifyBatches(input)
    const records = await runOne(ctx, SMALL, bs, RECLASSIFY_SCHEMA, reclassifyResultSchema, reclassifyPrompt(input.fx.issues))
    const m = scoreReclassify(bs, records, input.fx.issues)
    return {
      title: 'Reclassification',
      arm: armKey(SMALL),
      sample: `${m.stories} pre-assessment stories in ${bs.length} batches of up to ${config.preassess.batchSize}`,
      criteria: reclassifyCriteria(m),
      details: [`Issue ${pct(m.issueAgreement)}, emotion ${pct(m.emotionAgreement)} agreement with the stored values.`],
      stats: [summarizeCalls(armKey(SMALL), records)],
      monthly: null,
    }
  },
}

// ---------------------------------------------------------------------------
// Actually Uplifting selection
// ---------------------------------------------------------------------------

export interface UpliftingCase {
  id: string
  title: string
  stories: StoryForNewsletterSelect[]
  /** The longlist's uplifting stories (true), or its whole longlist when it has no more of them than the issue carries. */
  upliftingOnly: boolean
}

/**
 * One case per cached newsletter: its uplifting stories when more than the issue carries (the only
 * time production asks), else its whole longlist, since the format gate does not turn on the tone.
 */
export function upliftingCases(newsletters: NewsletterItem[], count = config.newsletter.uplifting.maxStories): UpliftingCase[] {
  return newsletters.map(n => {
    const uplifting = n.longlist.filter(s => s.emotionTag === 'uplifting')
    const upliftingOnly = uplifting.length > count
    return { id: n.id, title: n.title, stories: upliftingOnly ? uplifting : n.longlist, upliftingOnly }
  })
}

const upliftingItems = ({ fx, opts }: StepInput) => limited(upliftingCases(fx.newsletters), opts.limit)
const upliftingPrompt = (c: UpliftingCase) => buildUpliftingSelectPrompt(c.stories, Math.min(config.newsletter.uplifting.maxStories, c.stories.length))

export interface UpliftingMetrics {
  /** Share of cases answered with exactly the issue's count of valid, unique ids. */
  exactCount: number | null
  invalidIds: number
  declined: number
  failures: number
  picks: string[][]
}

export function scoreUplifting(cases: UpliftingCase[], records: CallRecord<{ selectedIds: string[] }>[]): UpliftingMetrics {
  const exact: boolean[] = []
  let invalidIds = 0
  let declined = 0
  let failures = 0
  const picks: string[][] = []
  cases.forEach((c, i) => {
    const r = records[i]
    const parsed = parsedOf(r)
    if (!parsed) {
      picks.push([])
      if (r?.outcome === 'skipped') return
      if (r?.outcome === 'empty') declined++
      else failures++
      exact.push(false)
      return
    }
    const ids = new Set(c.stories.map(s => s.id))
    const valid = [...new Set(parsed.selectedIds.filter(id => ids.has(id)))]
    invalidIds += parsed.selectedIds.filter(id => !ids.has(id)).length
    if (parsed.selectedIds.length === 0) declined++
    exact.push(valid.length === parsed.selectedIds.length && valid.length === Math.min(config.newsletter.uplifting.maxStories, c.stories.length))
    picks.push(valid)
  })
  return { exactCount: rate(exact), invalidIds, declined, failures, picks }
}

export function upliftingCriteria(m: UpliftingMetrics): Criterion[] {
  return [
    { name: 'Exact count, valid unique IDs', value: pct(m.exactCount), bar: '100%', pass: m.exactCount === 1, required: true },
    zero('Invalid IDs returned', m.invalidIds),
    zero('Declined or empty responses', m.declined),
    zero('Failed calls', m.failures),
  ]
}

const upliftingStep: RecalibrationStepDef = {
  name: 'uplifting-select',
  plan: input =>
    upliftingItems(input).map(c => ({ arm: LARGE, schemaName: UPLIFTING_SCHEMA, prompt: upliftingPrompt(c), baseOutputTokens: SELECT_OUTPUT_TOKENS })),
  async run(input, ctx) {
    const cases = upliftingItems(input)
    if (cases.length === 0) throw new Error('the cached fixtures have no newsletter longlist')
    const records = await runOne(ctx, LARGE, cases, UPLIFTING_SCHEMA, newsletterSelectResultSchema, upliftingPrompt)
    const m = scoreUplifting(cases, records)
    const titleOf = new Map(cases.flatMap(c => c.stories.map(s => [s.id, s.title ?? s.id])))
    return {
      title: 'Actually Uplifting selection',
      arm: armKey(LARGE),
      sample: `${cases.length} newsletter longlists, ${cases.filter(c => c.upliftingOnly).length} of them cut to their uplifting stories`,
      criteria: upliftingCriteria(m),
      details: cases.flatMap((c, i) => [
        `${c.title} (${c.stories.length} stories${c.upliftingOnly ? ', uplifting only' : ', whole longlist'}):`,
        ...(m.picks[i] ?? []).map(id => `- ${titleOf.get(id) ?? id}`),
      ]),
      stats: [summarizeCalls(armKey(LARGE), records)],
      monthly: null,
    }
  },
}

export const LAYOUT_STEP_DEFS = {
  reclassify: reclassifyStep,
  'uplifting-select': upliftingStep,
} satisfies Partial<Record<RecalibrationStep, RecalibrationStepDef>>
