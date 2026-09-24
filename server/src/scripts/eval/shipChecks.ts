/**
 * eval:recalibrate steps for the prompt changes that ship with the phase-2
 * model switch besides the rating recalibration (owner's decisions of
 * 2026-09-24), judged by shipRules.ts:
 * - `social-post`: Bluesky and Mastodon post text on gpt-6-luna.
 * - `selection`: editorial selection on gpt-6-sol with publication dates,
 *   including one stale-dated candidate per group.
 *
 * They run on the whole cached phase-1 sample (the calibration/holdout split
 * belongs to the rating recalibration) and only when named in `--steps`.
 * Calls use versioned schema names, as the recalibration's do.
 */
import { buildSelectPrompt } from '../../prompts/select.js'
import { blueskyPostTextSchema } from '../../schemas/bluesky.js'
import { selectResultSchema } from '../../schemas/llm.js'
import { mastodonPostTextSchema } from '../../schemas/mastodon.js'
import { pct, summarizeCalls } from './checks.js'
import type { SelectionGroup, SocialPostItem } from './fixtures.js'
import { arm, armKey, versionedSchemaName } from './models.js'
import type { RecalibrationStep } from './options.js'
import { monthlyAt, runOne, type RecalibrationStepDef, type StepInput } from './recalibrationChecks.js'
import {
  checkShipPost, datedForReplay, selectionCriteria, socialPostCriteria, STALE_DATE, staleProbeId, staleProbesKept, type ShipPostCheck,
} from './shipRules.js'
import { scoreSelection } from './suites/largeTier.js'
import { buildPhase1SelectPrompt } from './suites/selectPhase1Prompt.js'
import { limited, parsedOf } from './suites/shared.js'
import { POST_TOKENS, postPrompt } from './suites/social.js'

const POST_SCHEMA = {
  bluesky: versionedSchemaName('bluesky-post', blueskyPostTextSchema),
  mastodon: versionedSchemaName('mastodon-post', mastodonPostTextSchema),
}
const SOL = arm('gpt-6-sol', 'medium')
const SELECT_SCHEMA = versionedSchemaName('select', selectResultSchema)
/** Phase 1's own name for the call, under which its gpt-6-sol picks sit in the ledger. */
const PHASE1_SELECT_SCHEMA = 'select'
/** Phase 1 measured 522 output tokens per gpt-6-sol@medium selection; about twice that, for the budget gate. */
const SELECT_OUTPUT_TOKENS = 1100

// ---------------------------------------------------------------------------
// Social post text
// ---------------------------------------------------------------------------

/** Every cached post story, `--limit` applying per platform. */
const socialPosts = ({ fx, opts }: StepInput): SocialPostItem[] => [
  ...limited(fx.socialPost.filter(p => p.platform === 'bluesky'), opts.limit),
  ...limited(fx.socialPost.filter(p => p.platform === 'mastodon'), opts.limit),
]

const listSeparated = (items: string[]) => (items.length > 0 ? items.join(', ') : 'none')

function postLine(c: ShipPostCheck): string {
  const flags = [
    `names: ${listSeparated(c.anchors)}`,
    ...(c.unsupported.length > 0 ? [`numbers not in the story: ${c.unsupported.join(', ')}`] : []),
    ...(c.unstatedNames.length > 0 ? [`names not in the story: ${c.unstatedNames.join(', ')}`] : []),
    ...(c.overLimit ? [`over the ${c.item.story.maxChars}-character limit`] : []),
  ]
  return `- ${c.item.platform === 'bluesky' ? 'Bluesky' : 'Mastodon'}, "${c.item.story.title}": ${c.text.trim()} (${flags.join('; ')})`
}

const socialPostStep: RecalibrationStepDef = {
  name: 'social-post',
  plan: input => socialPosts(input).map(p => ({
    arm: arm('gpt-6-luna', input.opts.effort), schemaName: POST_SCHEMA[p.platform], prompt: postPrompt(p), baseOutputTokens: POST_TOKENS,
  })),
  async run(input, ctx) {
    const a = arm('gpt-6-luna', input.opts.effort)
    const items = socialPosts(input)
    const bluesky = items.filter(p => p.platform === 'bluesky')
    const mastodon = items.filter(p => p.platform === 'mastodon')
    const [bs, md] = await Promise.all([
      runOne(ctx, a, bluesky, POST_SCHEMA.bluesky, blueskyPostTextSchema, postPrompt),
      runOne(ctx, a, mastodon, POST_SCHEMA.mastodon, mastodonPostTextSchema, postPrompt),
    ])
    const records = [...bs, ...md]
    const checks = [...bluesky, ...mastodon].flatMap((p, i) => {
      const text = parsedOf(records[i])?.postText
      return text == null ? [] : [checkShipPost(p, text)]
    })
    const failed = records.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length
    const stats = summarizeCalls(armKey(a), records)
    return {
      title: 'Social post text',
      arm: armKey(a),
      sample: `${bluesky.length} Bluesky and ${mastodon.length} Mastodon stories (every cached post story)`,
      criteria: socialPostCriteria(checks, failed),
      details: ['Every draft, for the spot check against the story (text before production\'s ellipsis trim):', ...checks.map(postLine)],
      stats: [stats],
      monthly: monthlyAt('social-post', stats),
    }
  },
}

// ---------------------------------------------------------------------------
// Editorial selection
// ---------------------------------------------------------------------------

const selectionGroups = ({ fx, opts }: StepInput) => limited(fx.selection, opts.limit)
const replayGroup = (g: SelectionGroup) => datedForReplay(g, staleProbeId(g))
/** Today is the group's crawl day, when production would have run the selection. */
const replayPrompt = (g: SelectionGroup) => buildSelectPrompt(g.stories, g.toSelect, g.day)
const phase1Prompt = (g: SelectionGroup) => buildPhase1SelectPrompt(g.stories, g.toSelect)

const selectionStep: RecalibrationStepDef = {
  name: 'selection',
  plan: input => selectionGroups(input).map(g => ({
    arm: SOL, schemaName: SELECT_SCHEMA, prompt: replayPrompt(replayGroup(g)), baseOutputTokens: SELECT_OUTPUT_TOKENS,
  })),
  async preflight(input, phase1) {
    const gs = selectionGroups(input)
    await runOne(phase1, SOL, gs, PHASE1_SELECT_SCHEMA, selectResultSchema, phase1Prompt)
    return `phase 1's ${armKey(SOL)} picks read from the ledger for ${gs.length} groups; ${gs.filter(g => staleProbeId(g) != null).length} have a stale probe`
  },
  async run(input, ctx, phase1) {
    const gs = selectionGroups(input)
    const replay = gs.map(replayGroup)
    const [records, before] = await Promise.all([
      runOne(ctx, SOL, replay, SELECT_SCHEMA, selectResultSchema, replayPrompt),
      runOne(phase1, SOL, gs, PHASE1_SELECT_SCHEMA, selectResultSchema, phase1Prompt),
    ])
    const m = scoreSelection(replay, records, before)
    const probes = gs.map(staleProbeId)
    const picksOf = (recs: typeof records) => recs.map(r => parsedOf(r)?.selectedIds ?? null)
    const now = staleProbesKept(probes, picksOf(records))
    const then = staleProbesKept(probes, picksOf(before))
    const undated = gs.flatMap(g => g.stories).filter(s => s.sourceDatePublished === undefined).length
    const stats = summarizeCalls(armKey(SOL), records)
    return {
      title: 'Editorial selection',
      arm: armKey(SOL),
      sample: `${gs.length} selection groups, ${gs.reduce((n, g) => n + g.stories.length, 0)} candidates`,
      criteria: selectionCriteria(m),
      details: [
        ...(undated > 0 ? [`${undated} candidates were cached before fixtures carried a publication date, so they show their group's crawl day.`] : []),
        `Stale probe: in each group, the first story production selected was re-dated to ${STALE_DATE.slice(0, 10)}. The model kept it in ${now.kept} of ${now.probed} groups; without dates (phase 1, same model) it picked the same stories in ${then.kept} of ${then.probed}.`,
        `Overlap with phase 1's picks (Jaccard) ${pct(m.jaccardOther)}; with the stored decision ${pct(m.jaccardStored)}; uplifting share of picks ${pct(m.upliftingShare)}.`,
      ],
      stats: [stats],
      monthly: monthlyAt('selection', stats),
    }
  },
}

export const SHIP_STEP_DEFS = {
  'social-post': socialPostStep,
  selection: selectionStep,
} satisfies Partial<Record<RecalibrationStep, RecalibrationStepDef>>
