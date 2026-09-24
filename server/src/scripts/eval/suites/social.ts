/**
 * Social suite: story pick (replayed on past posting days) and post text
 * (Bluesky and Mastodon drafts). Post text goes to the owner's taste set.
 */
import { buildBlueskyPickBestPrompt, buildBlueskyPostPrompt } from '../../../prompts/bluesky.js'
import { buildMastodonPostPrompt } from '../../../prompts/mastodon.js'
import { blueskyPickBestSchema, blueskyPostTextSchema, type BlueskyPickBest } from '../../../schemas/bluesky.js'
import { mastodonPostTextSchema } from '../../../schemas/mastodon.js'
import type { Fixtures, SocialPickDay, SocialPostItem } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey } from '../models.js'
import { checkSocialPost, forbiddenContent, pct, rate, type SocialPostCheck } from '../checks.js'
import { pickLowestPassing } from '../decide.js'
import type { CallRecord, CallSiteResult, Decision, RatingItemDraft, Suite, SuiteContext } from '../types.js'
import { limited, metricRow, parsedOf, runArms, statsFor } from './shared.js'

const BASELINE = arm('gpt-5-mini', 'medium')
const CANDIDATE = arm('gpt-6-luna', 'medium')
const ARMS = [BASELINE, CANDIDATE]
const PICK_TOKENS = 1500
export const POST_TOKENS = 1500

const days = (fx: Fixtures, limit?: number) => limited(fx.socialPick, limit)
const posts = (fx: Fixtures, limit?: number) => {
  const per = limit ?? TARGETS.socialPost.perPlatform
  return [
    ...fx.socialPost.filter(p => p.platform === 'bluesky').slice(0, per),
    ...fx.socialPost.filter(p => p.platform === 'mastodon').slice(0, per),
  ]
}
const pickPrompt = (d: SocialPickDay) => buildBlueskyPickBestPrompt(d.candidates)
export const postPrompt = (p: SocialPostItem) => (p.platform === 'bluesky' ? buildBlueskyPostPrompt(p.story) : buildMastodonPostPrompt(p.story))
const postSchemaName = (p: SocialPostItem) => `${p.platform}-post`

// ---------------------------------------------------------------------------
// Pick
// ---------------------------------------------------------------------------

export interface PickArmMetrics {
  validRate: number | null
  storedAgreement: number | null
  armAgreement: number | null
}

function scorePick(ds: SocialPickDay[], recs: CallRecord<BlueskyPickBest>[], other: CallRecord<BlueskyPickBest>[]): PickArmMetrics {
  const picks = ds.map((d, i) => {
    const id = parsedOf(recs[i])?.storyId
    return id && d.candidates.some(c => c.id === id) ? id : null
  })
  return {
    validRate: rate(picks.map(p => p !== null)),
    storedAgreement: rate(ds.flatMap((d, i) => (d.storedPickId ? [picks[i] === d.storedPickId] : []))),
    armAgreement: rate(ds.map((_, i) => picks[i] !== null && picks[i] === parsedOf(other[i])?.storyId)),
  }
}

export function decideSocialPick(metrics: Record<string, PickArmMetrics>, candidates: string[]): Decision {
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => ({
      arm: c,
      failures: (metrics[c].validRate ?? 0) < 1 ? [`valid story ID rate ${pct(metrics[c].validRate)} < 100%`] : [],
      evidence: [`valid IDs ${pct(metrics[c].validRate)}; agreement with the posted story ${pct(metrics[c].storedAgreement)} (information only)`],
    })),
  )
}

// ---------------------------------------------------------------------------
// Post text
// ---------------------------------------------------------------------------

export interface PostArmMetrics {
  drafts: number
  overLimit: number
  forbidden: number
  extraEmDash: number
  failures: number
}

function postChecks(items: SocialPostItem[], recs: CallRecord<{ postText: string }>[]): (SocialPostCheck | null)[] {
  return items.map((p, i) => {
    const text = parsedOf(recs[i])?.postText
    return text == null ? null : checkSocialPost(text, { platform: p.platform, maxChars: p.story.maxChars, title: p.story.title })
  })
}

function scorePost(items: SocialPostItem[], recs: CallRecord<{ postText: string }>[]): PostArmMetrics {
  const checks = postChecks(items, recs).filter((c): c is SocialPostCheck => c !== null)
  return {
    drafts: checks.length,
    overLimit: checks.filter(c => c.overLimit).length,
    forbidden: checks.filter(forbiddenContent).length,
    extraEmDash: checks.filter(c => c.extraEmDash).length,
    failures: recs.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
  }
}

export function decideSocialPost(metrics: Record<string, PostArmMetrics>, baseline: string, candidates: string[]): Decision {
  const b = metrics[baseline]
  return pickLowestPassing(
    candidates.filter(c => metrics[c]).map(c => ({
      arm: c,
      failures: [
        ...(metrics[c].drafts === 0 ? ['no drafts returned'] : []),
        ...(metrics[c].overLimit > b.overLimit ? [`${metrics[c].overLimit} raw drafts over the limit (mini ${b.overLimit})`] : []),
        ...(metrics[c].forbidden > 0 ? [`${metrics[c].forbidden} drafts with URLs, mentions, disallowed hashtags, the title or junk`] : []),
        ...(metrics[c].failures > b.failures ? [`${metrics[c].failures} failed calls (mini ${b.failures})`] : []),
      ],
      evidence: [`${metrics[c].overLimit} over-limit drafts (mini ${b.overLimit}); no forbidden content`],
    })),
  )
}

/** What production would post: the draft trimmed to the limit with an ellipsis. */
function asPublished(text: string, maxChars: number): string {
  const blurb = text.trim()
  return blurb.length > maxChars ? blurb.slice(0, maxChars - 1) + '…' : blurb
}

function postRatingDrafts(items: SocialPostItem[], records: Map<string, CallRecord<{ postText: string }>[]>): RatingItemDraft[] {
  const base = records.get(armKey(BASELINE)) ?? []
  const cand = records.get(armKey(CANDIDATE)) ?? []
  const baseChecks = postChecks(items, base)
  const candChecks = postChecks(items, cand)
  return items.flatMap((p, i) => {
    const a = parsedOf(base[i])?.postText
    const b = parsedOf(cand[i])?.postText
    if (a == null || b == null) return []
    const broke = [baseChecks[i], candChecks[i]].some(c => c != null && (c.overLimit || forbiddenContent(c) || c.extraEmDash))
    return [{
      set: 'social-post' as const,
      key: `${p.platform}:${p.id}`,
      context_md: [
        `Platform: ${p.platform === 'bluesky' ? 'Bluesky' : 'Mastodon'} (text limit ${p.story.maxChars} characters; longer drafts are cut with an ellipsis)`,
        '',
        `**${p.story.title}**`,
        '',
        `Summary: ${p.story.summary}`,
        ...(p.story.relevanceSummary ? ['', `Why it matters: ${p.story.relevanceSummary}`] : []),
      ].join('\n'),
      options: [
        { arm: armKey(BASELINE), content_md: asPublished(a, p.story.maxChars) },
        { arm: armKey(CANDIDATE), content_md: asPublished(b, p.story.maxChars) },
      ],
      tags: { platform: p.platform, brokeRule: broke },
    }]
  })
}

async function runPosts(ctx: SuiteContext, items: SocialPostItem[]) {
  const bluesky = items.filter(p => p.platform === 'bluesky')
  const mastodon = items.filter(p => p.platform === 'mastodon')
  const [bs, md] = await Promise.all([
    runArms(ctx, ARMS, bluesky, 'bluesky-post', blueskyPostTextSchema, postPrompt),
    runArms(ctx, ARMS, mastodon, 'mastodon-post', mastodonPostTextSchema, postPrompt),
  ])
  const ordered = [...bluesky, ...mastodon]
  const merged = new Map(ARMS.map(a => [armKey(a), [...(bs.get(armKey(a)) ?? []), ...(md.get(armKey(a)) ?? [])]]))
  return { ordered, records: merged }
}

export const socialSuite: Suite = {
  name: 'social',
  arms: ARMS,
  describe(fx, limit) {
    const p = posts(fx, limit)
    return [
      `social pick: ${days(fx, limit).length} days (target ${TARGETS.socialPick.days})${fx.socialPickSynthetic ? ', synthetic windows (no stored posts)' : ''}`,
      `social post: ${p.filter(x => x.platform === 'bluesky').length} Bluesky + ${p.filter(x => x.platform === 'mastodon').length} Mastodon (target ${TARGETS.socialPost.perPlatform} each)`,
    ]
  },
  plan(fx, limit) {
    return [
      ...days(fx, limit).flatMap(d => ARMS.map(a => ({ arm: a, schemaName: 'social-pick', prompt: pickPrompt(d), baseOutputTokens: PICK_TOKENS }))),
      ...posts(fx, limit).flatMap(p => ARMS.map(a => ({ arm: a, schemaName: postSchemaName(p), prompt: postPrompt(p), baseOutputTokens: POST_TOKENS }))),
    ]
  },
  async run(fx, ctx) {
    const ds = days(fx, ctx.limit)
    const [pickRecords, post] = await Promise.all([
      runArms(ctx, ARMS, ds, 'social-pick', blueskyPickBestSchema, pickPrompt),
      runPosts(ctx, posts(fx, ctx.limit)),
    ])
    const baseKey = armKey(BASELINE)
    const candKey = armKey(CANDIDATE)
    const pickMetrics = {
      [baseKey]: scorePick(ds, pickRecords.get(baseKey) ?? [], pickRecords.get(candKey) ?? []),
      [candKey]: scorePick(ds, pickRecords.get(candKey) ?? [], pickRecords.get(baseKey) ?? []),
    }
    const postMetrics = Object.fromEntries([...post.records].map(([k, recs]) => [k, scorePost(post.ordered, recs)]))
    const count = (v: number | null) => String(v ?? 0)
    const pickSite: CallSiteResult = {
      id: 'social-pick',
      title: 'Social story pick',
      baseline: baseKey,
      candidates: [candKey],
      stats: statsFor(pickRecords),
      metrics: [
        metricRow('Valid story ID', pickMetrics, m => m.validRate, pct, 'higher'),
        metricRow('Agrees with the story actually posted', pickMetrics, m => m.storedAgreement, pct),
        metricRow('Agrees with the other arm', pickMetrics, m => m.armAgreement, pct),
      ],
      decision: decideSocialPick(pickMetrics, [candKey]),
      notes: [fx.socialPickSynthetic
        ? 'No published social posts were found, so the replay used synthetic daily windows with no stored pick.'
        : 'The stored pick is the first story posted that day; admin picks and manual posts blur it, so agreement is information only.'],
    }
    const postSite: CallSiteResult = {
      id: 'social-post',
      title: 'Social post text',
      baseline: baseKey,
      candidates: [candKey],
      stats: statsFor(post.records),
      metrics: [
        metricRow('Drafts', postMetrics, m => m.drafts, count),
        metricRow('Raw drafts over the limit (before the ellipsis trim)', postMetrics, m => m.overLimit, count, 'lower'),
        metricRow('Drafts with forbidden content', postMetrics, m => m.forbidden, count, 'lower'),
        metricRow('Drafts with more than one em dash', postMetrics, m => m.extraEmDash, count, 'lower'),
        metricRow('Failed calls', postMetrics, m => m.failures, count, 'lower'),
      ],
      decision: decideSocialPost(postMetrics, baseKey, [candKey]),
      ratingSet: 'social-post',
      notes: ['Rating options show the text as production would post it (trimmed to the limit), without the identical metadata line.'],
    }
    return { callSites: [pickSite, postSite], ratingItems: postRatingDrafts(post.ordered, post.records), notes: [] }
  },
}
