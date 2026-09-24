/**
 * eval:recalibrate steps for the prompt changes that ship with the phase-2
 * model switch besides the rating recalibration (owner's decisions of
 * 2026-09-24), judged by shipRules.ts:
 * - `social-post`: Bluesky and Mastodon post text on gpt-6-luna.
 *
 * They run on the whole cached phase-1 sample (the calibration/holdout split
 * belongs to the rating recalibration) and only when named in `--steps`.
 * Calls use versioned schema names, as the recalibration's do.
 */
import { blueskyPostTextSchema } from '../../schemas/bluesky.js'
import { mastodonPostTextSchema } from '../../schemas/mastodon.js'
import { summarizeCalls } from './checks.js'
import type { SocialPostItem } from './fixtures.js'
import { arm, armKey, versionedSchemaName } from './models.js'
import type { RecalibrationStep } from './options.js'
import { monthlyAt, runOne, type RecalibrationStepDef, type StepInput } from './recalibrationChecks.js'
import { checkShipPost, socialPostCriteria, type ShipPostCheck } from './shipRules.js'
import { limited, parsedOf } from './suites/shared.js'
import { POST_TOKENS, postPrompt } from './suites/social.js'

const POST_SCHEMA = {
  bluesky: versionedSchemaName('bluesky-post', blueskyPostTextSchema),
  mastodon: versionedSchemaName('mastodon-post', mastodonPostTextSchema),
}

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

export const SHIP_STEP_DEFS = {
  'social-post': socialPostStep,
} satisfies Partial<Record<RecalibrationStep, RecalibrationStepDef>>
