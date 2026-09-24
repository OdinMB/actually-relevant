/**
 * Large-tier suite: editorial selection, newsletter selection, newsletter
 * intro and podcast script. They share OPENAI_MODEL_LARGE, so they are
 * evaluated (and later switched) together: gpt-5.2 rerun vs gpt-6-sol.
 * Sol's known risk is declining more often on "pick exactly N" prompts, so
 * exact-count compliance is the gate.
 */
import { buildSelectPrompt } from '../../../prompts/select.js'
import { buildNewsletterSelectPrompt } from '../../../prompts/newsletter-select.js'
import { buildNewsletterIntroPrompt } from '../../../prompts/newsletter-intro.js'
import { buildPodcastPrompt } from '../../../prompts/podcast.js'
import {
  newsletterIntroSchema, newsletterSelectResultSchema, podcastScriptSchema, selectResultSchema,
  type NewsletterIntro, type PodcastScript, type SelectResult,
} from '../../../schemas/llm.js'
import type { Fixtures, NewsletterItem, PodcastItem, SelectionGroup } from '../fixtures.js'
import { TARGETS } from '../fixtures.js'
import { arm, armKey } from '../models.js'
import { checkIntro, checkPodcast, introViolations, jaccard, mean, num, pct, rate, type IntroCheck } from '../checks.js'
import { pickLowestPassing } from '../decide.js'
import type { CallRecord, CallSiteResult, Decision, RatingItemDraft, Suite } from '../types.js'
import { limited, metricRow, parsedOf, runArms, statsFor } from './shared.js'

const BASELINE = arm('gpt-5.2', 'medium')
const CANDIDATE = arm('gpt-6-sol', 'medium')
const ARMS = [BASELINE, CANDIDATE]
const BASE_KEY = armKey(BASELINE)
const CAND_KEY = armKey(CANDIDATE)
const TOKENS = { selection: 4500, newsletterSelect: 4000, intro: 1500, podcast: 6000 }

const groups = (fx: Fixtures, limit?: number) => limited(fx.selection, limit)
const newsletters = (fx: Fixtures, limit?: number) => limited(fx.newsletters, limit)
const podcasts = (fx: Fixtures, limit?: number): PodcastItem[] => (fx.podcast && (limit == null || limit > 0) ? [fx.podcast] : [])

const selectPrompt = (g: SelectionGroup) => buildSelectPrompt(g.stories, g.toSelect)
const newsletterPrompt = (n: NewsletterItem) => buildNewsletterSelectPrompt(n.longlist, n.storiesPerIssue, n.issueNames)
const introPrompt = (n: NewsletterItem) => buildNewsletterIntroPrompt(n.intro.stories, n.intro.issueNames, n.intro.style)
const podcastPrompt = (p: PodcastItem) => buildPodcastPrompt(p.stories)

const failuresOf = (recs: CallRecord[]) => recs.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length
const count = (v: number | null) => String(v ?? 0)

/** Valid, unique picks in candidate order, plus the invalid count. */
function picksOf(result: SelectResult | null, candidateIds: string[]): { picks: string[]; invalid: number } {
  if (!result) return { picks: [], invalid: 0 }
  const chosen = new Set(result.selectedIds)
  return {
    picks: candidateIds.filter(id => chosen.has(id)),
    invalid: result.selectedIds.filter(id => !candidateIds.includes(id)).length,
  }
}

/** An empty response, or an empty pick list, is a decline. */
const declined = (r: CallRecord<SelectResult> | undefined) =>
  r?.outcome === 'empty' || (r?.outcome === 'ok' && (r.parsed?.selectedIds.length ?? 0) === 0)

// ---------------------------------------------------------------------------
// Editorial selection
// ---------------------------------------------------------------------------

export interface SelectionArmMetrics {
  exactCount: number | null
  invalidIds: number
  declined: number
  failures: number
  jaccardStored: number | null
  jaccardOther: number | null
  upliftingShare: number | null
}

function scoreSelection(gs: SelectionGroup[], recs: CallRecord<SelectResult>[], other: CallRecord<SelectResult>[]): SelectionArmMetrics {
  const per = gs.map((g, i) => {
    const ids = g.stories.map(s => s.id)
    const parsed = parsedOf(recs[i])
    return { g, parsed, ...picksOf(parsed, ids), other: picksOf(parsedOf(other[i]), ids).picks }
  })
  const answered = per.filter(p => p.parsed != null)
  const emotion = new Map(gs.flatMap(g => g.stories.map(s => [s.id, s.emotionTag] as const)))
  return {
    exactCount: rate(per.map(p => p.parsed != null && p.invalid === 0 && p.picks.length === p.g.toSelect && p.parsed.selectedIds.length === p.g.toSelect)),
    invalidIds: per.reduce((n, p) => n + p.invalid, 0),
    declined: recs.filter(declined).length,
    failures: failuresOf(recs),
    jaccardStored: mean(answered.map(p => jaccard(p.picks, p.g.storedPicked))),
    jaccardOther: mean(per.filter((p, i) => p.parsed != null && parsedOf(other[i]) != null).map(p => jaccard(p.picks, p.other))),
    upliftingShare: rate(answered.flatMap(p => p.picks.map(id => emotion.get(id) === 'uplifting'))),
  }
}

export function decideSelection(metrics: Record<string, SelectionArmMetrics>, baseline: string, candidate: string): Decision {
  const b = metrics[baseline]
  const m = metrics[candidate]
  if (b?.exactCount == null || m?.exactCount == null) return { verdict: { kind: 'none', reasons: ['no selection groups were evaluated'] }, passing: [] }
  // Absolute bar 100%, relaxed to gpt-5.2's own rate only if gpt-5.2 misses it too.
  const bar = (b.exactCount ?? 0) < 1 ? b.exactCount ?? 0 : 1
  return pickLowestPassing([{
    arm: candidate,
    failures: [
      ...((m.exactCount ?? 0) < bar ? [`exact-count compliance ${pct(m.exactCount)} < ${pct(bar)}`] : []),
      ...(m.declined > b.declined ? [`${m.declined} declined/empty responses (gpt-5.2 ${b.declined})`] : []),
      ...(m.failures > b.failures ? [`${m.failures} failed calls (gpt-5.2 ${b.failures})`] : []),
    ],
    evidence: [`exact count ${pct(m.exactCount)} (gpt-5.2 ${pct(b.exactCount)}), declines ${m.declined} (gpt-5.2 ${b.declined})`],
  }])
}

function selectionDrafts(gs: SelectionGroup[], records: Map<string, CallRecord<SelectResult>[]>): RatingItemDraft[] {
  const base = records.get(BASE_KEY) ?? []
  const cand = records.get(CAND_KEY) ?? []
  return gs.flatMap((g, i) => {
    const ids = g.stories.map(s => s.id)
    const a = parsedOf(base[i])
    const b = parsedOf(cand[i])
    if (!a || !b) return []
    const pa = picksOf(a, ids).picks
    const pb = picksOf(b, ids).picks
    const title = new Map(g.stories.map(s => [s.id, s.title ?? '(untitled)']))
    const render = (picks: string[]) => picks.map(id => `- ${title.get(id)}`).join('\n') || '(no valid picks)'
    return [{
      set: 'story-selection' as const,
      key: g.id,
      context_md: [
        `Pick ${g.toSelect} of ${g.stories.length} candidate stories.`,
        '',
        ...g.stories.map((s, n) => `${n + 1}. **${s.title ?? '(untitled)'}** (${s.emotionTag ?? 'calm'}, rated ${s.relevance ?? '?'}/10)\n   ${s.summary ?? ''}`),
      ].join('\n'),
      options: [
        { arm: BASE_KEY, content_md: render(pa) },
        { arm: CAND_KEY, content_md: render(pb) },
      ],
      tags: { jaccard: jaccard(pa, pb) },
    }]
  })
}

// ---------------------------------------------------------------------------
// Newsletter selection
// ---------------------------------------------------------------------------

export interface NewsletterSelectArmMetrics {
  perIssueCompliance: number | null
  invalidIds: number
  declined: number
  failures: number
  jaccardStored: number | null
  upliftingShare: number | null
}

function scoreNewsletterSelect(ns: NewsletterItem[], recs: CallRecord<SelectResult>[]): NewsletterSelectArmMetrics {
  const per = ns.map((n, i) => ({ n, parsed: parsedOf(recs[i]), ...picksOf(parsedOf(recs[i]), n.longlist.map(s => s.id)) }))
  const answered = per.filter(p => p.parsed != null)
  const compliant = (p: (typeof per)[number]) =>
    p.n.issueNames.every(issue => {
      const available = p.n.longlist.filter(s => s.issueName === issue).map(s => s.id)
      const picked = p.picks.filter(id => available.includes(id)).length
      return picked === Math.min(p.n.storiesPerIssue, available.length)
    })
  const emotion = new Map(ns.flatMap(n => n.longlist.map(s => [s.id, s.emotionTag] as const)))
  return {
    perIssueCompliance: rate(per.map(p => p.parsed != null && p.invalid === 0 && compliant(p))),
    invalidIds: per.reduce((n, p) => n + p.invalid, 0),
    declined: recs.filter(declined).length,
    failures: failuresOf(recs),
    jaccardStored: mean(answered.map(p => jaccard(p.picks, p.n.storedSelected))),
    upliftingShare: rate(answered.flatMap(p => p.picks.map(id => emotion.get(id) === 'uplifting'))),
  }
}

// ---------------------------------------------------------------------------
// Intro and podcast
// ---------------------------------------------------------------------------

export interface IntroArmMetrics {
  violations: number
  byRule: Record<keyof IntroCheck, number>
  failures: number
}

function scoreIntro(recs: CallRecord<NewsletterIntro>[]): IntroArmMetrics {
  const checks = recs.flatMap(r => {
    const intro = parsedOf(r)?.intro
    return intro == null ? [] : [checkIntro(intro)]
  })
  const rules: (keyof IntroCheck)[] = ['over60Words', 'sentenceCount', 'bannedPhrase', 'emDash', 'markdown']
  return {
    violations: checks.reduce((n, c) => n + introViolations(c), 0),
    byRule: Object.fromEntries(rules.map(k => [k, checks.filter(c => c[k]).length])) as Record<keyof IntroCheck, number>,
    failures: failuresOf(recs),
  }
}

export interface PodcastArmMetrics {
  longSentenceShare: number | null
  publisherCoverage: number | null
  markup: number
  failures: number
}

function scorePodcast(ps: PodcastItem[], recs: CallRecord<PodcastScript>[]): PodcastArmMetrics {
  const checks = ps.flatMap((p, i) => {
    const script = parsedOf(recs[i])?.script
    return script == null ? [] : [checkPodcast(script, p.stories.map(s => s.publisher))]
  })
  return {
    longSentenceShare: mean(checks.flatMap(c => (c.longSentenceShare == null ? [] : [c.longSentenceShare]))),
    publisherCoverage: mean(checks.flatMap(c => (c.publisherCoverage == null ? [] : [c.publisherCoverage]))),
    markup: checks.filter(c => c.markup).length,
    failures: failuresOf(recs),
  }
}

/** Candidate must be no worse than the gpt-5.2 rerun on each listed "lower is better" count. */
function noWorseThanBaseline(label: string, items: number, checks: { name: string; cand: number | null; base: number | null }[]): Decision {
  if (items === 0) return { verdict: { kind: 'none', reasons: [`${label}: no fixture items were evaluated`] }, passing: [] }
  return pickLowestPassing([{
    arm: CAND_KEY,
    failures: checks
      .filter(c => (c.cand ?? Infinity) > (c.base ?? 0))
      .map(c => `${label} ${c.name}: ${num(c.cand)} > gpt-5.2 ${num(c.base)}`),
    evidence: checks.map(c => `${c.name}: ${num(c.cand)} (gpt-5.2 ${num(c.base)})`),
  }])
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

function textDrafts<T>(
  set: 'newsletter-intro' | 'podcast-script',
  items: { key: string; context_md: string }[],
  records: Map<string, CallRecord<T>[]>,
  text: (t: T) => string,
): RatingItemDraft[] {
  const base = records.get(BASE_KEY) ?? []
  const cand = records.get(CAND_KEY) ?? []
  return items.flatMap((item, i) => {
    const a = parsedOf(base[i])
    const b = parsedOf(cand[i])
    if (!a || !b) return []
    return [{ set, key: item.key, context_md: item.context_md, options: [{ arm: BASE_KEY, content_md: text(a) }, { arm: CAND_KEY, content_md: text(b) }], tags: {} }]
  })
}

export const largeTierSuite: Suite = {
  name: 'large',
  arms: ARMS,
  describe(fx, limit) {
    return [
      `selection: ${groups(fx, limit).length} historical groups (target ${TARGETS.selection.groups})`,
      `newsletter selection and intro: ${newsletters(fx, limit).length} newsletters (target ${TARGETS.newsletters.count})`,
      `podcast: ${fx.podcast ? `${fx.podcast.stories.length} stories (${fx.podcast.source})` : 'none'}`,
    ]
  },
  plan(fx, limit) {
    const planFor = <I>(items: I[], schemaName: string, prompt: (i: I) => string, tokens: number) =>
      items.flatMap(i => ARMS.map(a => ({ arm: a, schemaName, prompt: prompt(i), baseOutputTokens: tokens })))
    return [
      ...planFor(groups(fx, limit), 'select', selectPrompt, TOKENS.selection),
      ...planFor(newsletters(fx, limit), 'newsletter-select', newsletterPrompt, TOKENS.newsletterSelect),
      ...planFor(newsletters(fx, limit), 'newsletter-intro', introPrompt, TOKENS.intro),
      ...planFor(podcasts(fx, limit), 'podcast', podcastPrompt, TOKENS.podcast),
    ]
  },
  async run(fx, ctx) {
    const gs = groups(fx, ctx.limit)
    const ns = newsletters(fx, ctx.limit)
    const ps = podcasts(fx, ctx.limit)
    const [sel, nsel, intro, pod] = await Promise.all([
      runArms(ctx, ARMS, gs, 'select', selectResultSchema, selectPrompt),
      runArms(ctx, ARMS, ns, 'newsletter-select', newsletterSelectResultSchema, newsletterPrompt),
      runArms(ctx, ARMS, ns, 'newsletter-intro', newsletterIntroSchema, introPrompt),
      runArms(ctx, ARMS, ps, 'podcast', podcastScriptSchema, podcastPrompt),
    ])
    const selM = {
      [BASE_KEY]: scoreSelection(gs, sel.get(BASE_KEY) ?? [], sel.get(CAND_KEY) ?? []),
      [CAND_KEY]: scoreSelection(gs, sel.get(CAND_KEY) ?? [], sel.get(BASE_KEY) ?? []),
    }
    const nselM = Object.fromEntries([...nsel].map(([k, r]) => [k, scoreNewsletterSelect(ns, r)]))
    const introM = Object.fromEntries([...intro].map(([k, r]) => [k, scoreIntro(r)]))
    const podM = Object.fromEntries([...pod].map(([k, r]) => [k, scorePodcast(ps, r)]))
    const storedUplifting = rate(gs.flatMap(g => g.stories.filter(s => g.storedPicked.includes(s.id)).map(s => s.emotionTag === 'uplifting')))

    const sites: CallSiteResult[] = [
      {
        id: 'selection', title: 'Editorial selection', baseline: BASE_KEY, candidates: [CAND_KEY], stats: statsFor(sel),
        metrics: [
          metricRow('Exact count, valid unique IDs', selM, m => m.exactCount, pct, 'higher'),
          metricRow('Invalid IDs returned', selM, m => m.invalidIds, count, 'lower'),
          metricRow('Declined or empty responses', selM, m => m.declined, count, 'lower'),
          metricRow('Failed calls', selM, m => m.failures, count, 'lower'),
          metricRow('Overlap with stored decision (Jaccard)', selM, m => m.jaccardStored, pct),
          metricRow('Overlap between arms (Jaccard)', selM, m => m.jaccardOther, pct),
          metricRow('Uplifting share of picks', selM, m => m.upliftingShare, pct),
        ],
        decision: decideSelection(selM, BASE_KEY, CAND_KEY),
        ratingSet: 'story-selection',
        notes: [
          `Stored picks' uplifting share: ${pct(storedUplifting)}. The stored decision (selected/published = picked) is approximate: admin edits and later dedup rejections blur it.`,
        ],
      },
      {
        id: 'newsletter-select', title: 'Newsletter selection', baseline: BASE_KEY, candidates: [CAND_KEY], stats: statsFor(nsel),
        metrics: [
          metricRow('Per-issue count compliance', nselM, m => m.perIssueCompliance, pct, 'higher'),
          metricRow('Invalid IDs returned', nselM, m => m.invalidIds, count, 'lower'),
          metricRow('Declined or empty responses', nselM, m => m.declined, count, 'lower'),
          metricRow('Failed calls', nselM, m => m.failures, count, 'lower'),
          metricRow('Overlap with stored selection (Jaccard)', nselM, m => m.jaccardStored, pct),
          metricRow('Uplifting share of picks', nselM, m => m.upliftingShare, pct),
        ],
        decision: noWorseThanBaseline('newsletter selection', ns.length, [
          { name: 'non-compliant newsletters', cand: 1 - (nselM[CAND_KEY]?.perIssueCompliance ?? 0), base: 1 - (nselM[BASE_KEY]?.perIssueCompliance ?? 0) },
          { name: 'declines', cand: nselM[CAND_KEY]?.declined ?? null, base: nselM[BASE_KEY]?.declined ?? null },
          { name: 'failed calls', cand: nselM[CAND_KEY]?.failures ?? null, base: nselM[BASE_KEY]?.failures ?? null },
        ]),
        notes: [],
      },
      {
        id: 'newsletter-intro', title: 'Newsletter intro', baseline: BASE_KEY, candidates: [CAND_KEY], stats: statsFor(intro),
        metrics: [
          metricRow('Hard-rule violations (total)', introM, m => m.violations, count, 'lower'),
          ...(['over60Words', 'sentenceCount', 'bannedPhrase', 'emDash', 'markdown'] as const).map(rule =>
            metricRow(`Violations: ${rule}`, introM, m => m.byRule[rule], count, 'lower')),
          metricRow('Failed calls', introM, m => m.failures, count, 'lower'),
        ],
        decision: noWorseThanBaseline('intro', ns.length, [
          { name: 'hard-rule violations', cand: introM[CAND_KEY]?.violations ?? null, base: introM[BASE_KEY]?.violations ?? null },
          { name: 'failed calls', cand: introM[CAND_KEY]?.failures ?? null, base: introM[BASE_KEY]?.failures ?? null },
        ]),
        ratingSet: 'newsletter-intro',
        notes: ['Each newsletter uses one intro style, drawn once with pickIntroStyle() and stored in the fixture, so both arms get the same prompt.'],
      },
      {
        id: 'podcast', title: 'Podcast script', baseline: BASE_KEY, candidates: [CAND_KEY], stats: statsFor(pod),
        metrics: [
          metricRow('Sentences over 12 words', podM, m => m.longSentenceShare, pct, 'lower'),
          metricRow('Publishers mentioned', podM, m => m.publisherCoverage, pct, 'higher'),
          metricRow('Scripts with markup or stage directions', podM, m => m.markup, count, 'lower'),
          metricRow('Failed calls', podM, m => m.failures, count, 'lower'),
        ],
        decision: noWorseThanBaseline('podcast', ps.length, [
          { name: 'share of sentences over 12 words', cand: podM[CAND_KEY]?.longSentenceShare ?? null, base: podM[BASE_KEY]?.longSentenceShare ?? null },
          { name: 'failed calls', cand: podM[CAND_KEY]?.failures ?? null, base: podM[BASE_KEY]?.failures ?? null },
        ]),
        ratingSet: 'podcast-script',
        notes: fx.podcast?.source === 'recent-stories' ? ['No stored podcast had stories, so the fixture uses the week of published/selected stories before the anchor.'] : [],
      },
    ]

    const ratingItems = [
      ...selectionDrafts(gs, sel),
      ...textDrafts('newsletter-intro', ns.map(n => ({
        key: n.id,
        context_md: [`Style instruction: ${n.intro.style}`, '', 'Stories in this edition:', ...n.intro.stories.map(s => `- **${s.title}** (${s.issueName}, ${s.emotionTag}): ${s.blurb}`)].join('\n'),
      })), intro, (t: NewsletterIntro) => t.intro),
      ...textDrafts('podcast-script', ps.map(p => ({
        key: p.id,
        context_md: ['Stories to cover:', ...p.stories.map(s => `- ${s.category}: **${s.title}** (${s.publisher})`)].join('\n'),
      })), pod, (t: PodcastScript) => t.script),
    ]
    return { callSites: sites, ratingItems, notes: [] }
  },
}
