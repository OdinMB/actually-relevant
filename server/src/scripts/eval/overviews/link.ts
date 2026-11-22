/**
 * The overview linking steps, `link`, `found` and `role` (`.context/model-eval.md`, "Overview evals";
 * plan "Evals and bars"): one replay serves all three. The answer keys of a half (`developmentHalves.ts`)
 * give their entries and near misses, replayed together in date order through production's pure
 * linking (`linkInOrder`, `linkStory`) against the in-memory sandbox (`overviewSandbox.ts`), with
 * production's prompts on the eval's cached calls at the step tiers. A judged run replays background
 * beside them (`backgroundOf`, ADR-0073): the entries of each key outside the half that shares an entry
 * with its replay, so a neighbouring development has its own stories, as in production, and its
 * look-alikes among the judged stories found no overview it would not. Neighbours come from
 * production's candidate query, read-only and as of each story's date, kept to the replayed stories;
 * the stories as linking reads them. Then the strong judge compares each development's founded end
 * event with the key's, and `linkScore.ts` scores the bars (a background story only where it joins a
 * judged development's overview), and counts how often the link calls flagged the re-center signals:
 * on a key's center entries (replayed too; the bars ignore them in their own key's overview), on base
 * near misses, and as false shifts; and `linkDiagnostics.ts` says why each missed must entry was
 * missed, which roles disagree and what each founding chartered. Each run k ≥ 2 has its own cache
 * keys. It refuses, before any read or call, while a key of its half holds a center no one has
 * reviewed.
 */
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { linkInOrder, type LinkDeps, type ModelCall } from '../../../services/overviewLink.js'
import { overviewCalls, type OverviewCalls, type OverviewStep } from '../../../services/overviewSteps.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import type { Prompt } from '../../../lib/promptCache.js'
import type { z } from 'zod'
import { arm, versionedSchemaName } from '../models.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import type { Arm, SuiteContext } from '../types.js'
import { JUDGE_ARM } from './contextJudge.js'
import { config } from '../../../config.js'
import { keysOfHalf } from './developmentHalves.js'
import { diagnoseRun, traceOf, type FoundedOverview, type NeighbourCount, type RunDiagnostics, type StoryTrace } from './linkDiagnostics.js'
import { linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, centerSlugs, type AnswerKey } from './keySchema.js'
import { scoreLinking, scoreSignals, type EndEventVerdict, type LinkScore, type ReplayRun, type SignalRunScore, type StorySignal } from './linkScore.js'
import { createSandbox, type Sandbox } from './overviewSandbox.js'
import { buildEndEventJudgePrompt, endEventJudgeSchema } from './prompts.js'

/** Production's step tiers today, as the eval's arms (the overview steps' evals all take theirs from here). */
export const TIER_ARMS: Record<'small' | 'medium' | 'large', Arm> = {
  small: arm('gpt-6-luna', 'low'),
  medium: arm('gpt-6-luna', 'medium'),
  large: arm('gpt-6.1-sol', 'medium'),
}
/** A step's arm: its tier's, at the step's own effort where it has one (the audit's). */
export const stepArm = (step: OverviewStep<unknown>): Arm => ({ ...TIER_ARMS[step.tier], ...(step.effort ? { effort: step.effort } : {}) })

/** The strong judge's question on an end event: a founded one here, a re-centered one in `recenter.ts`. */
export const END_EVENT_SCHEMA = versionedSchemaName('overview-end-event-judge', endEventJudgeSchema)

export interface LinkStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  /** The stories as linking reads them, by slug (null for one not published). */
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  /** Production's neighbours of a story as of its date (`nearestPublished`, read-only). */
  neighbours(story: LinkStory): Promise<Neighbour[]>
  repeat: number
  concurrency: number
  budgetUsd: number
  /** Replay only the first N stories in date order (a smoke run). */
  limit?: number
}

export interface LinkStepReport {
  half: LinkStepOptions['half']
  repeat: number
  limit?: number
  /** The keys replayed, and the stories replayed in all (the half's entries and near misses, and the background). */
  keys: string[]
  stories: number
  /** A judged run's background (`backgroundOf`): the keys outside the half it came from, and its stories among those replayed. */
  background: { keys: string[]; stories: number }
  left: { what: string; reason: string }[]
  score: LinkScore
  endEvents: { key: string; run: number; verdict: EndEventVerdict; why: string }[]
  /** How often each run's link calls flagged the re-center signals (no bars). */
  signals: SignalRunScore[]
  /** Each run's missed must entries with why, role disagreements and founded charters (no bars). */
  diagnostics: RunDiagnostics[]
  /** Calls that got no answer because none was made: past the budget, or not in the cache with `--cache-only`. */
  unanswered: number
  /** The replay's model spend per run, and per story. */
  costUsd: number
  perStoryUsd: number | null
  stopped?: string
}

/** A model call on the eval's cache, as `structuredCall` returns it to production's steps. */
export async function evalCall<T>(ctx: SuiteContext, a: Arm, schemaName: string, schema: z.ZodType<T>, prompt: Prompt, run: number): Promise<ModelCall<T>> {
  const rec = await ctx.call(a, runSchemaName(schemaName, run), schema, prompt)
  return { parsed: rec.outcome === 'ok' ? rec.parsed : null, costUsd: rec.costUsd, model: a.model }
}

/** Production's model calls of the step (`overviewCalls`) on the eval's cache, each at its step's arm, run k ≥ 2 under its own key. */
export const evalCalls = (ctx: SuiteContext, run: number): OverviewCalls =>
  overviewCalls((step, prompt) => evalCall(ctx, stepArm(step), versionedSchemaName(step.name, step.schema), step.schema, prompt, run))

/** Every slug the half's keys replay: entries (must and optional), near misses, and their centers' entries and near misses, once. */
export function replaySlugs(keys: readonly AnswerKey[]): string[] {
  return [...new Set(keys.flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug), ...centerSlugs(k)]))]
}

/**
 * The background of the half's replay (ADR-0073): each key outside the half whose own base entry the
 * replay holds adds its base entries (must and optional) that the replay does not hold yet, each slug
 * once; `keys` are those that add one. One hop only, and never a key's near misses or centers: a key
 * whose near miss is a judged story has none of its own stories there, and adding its entries, or a
 * background key's near misses, would bring look-alikes in one step further out.
 */
export function backgroundOf(keys: readonly AnswerKey[], others: readonly AnswerKey[]): { keys: AnswerKey[]; slugs: string[] } {
  const replay = new Set(replaySlugs(keys))
  const slugs = new Set<string>()
  const from: AnswerKey[] = []
  for (const k of others) {
    if (!k.entries.some(e => replay.has(e.slug))) continue
    const added = k.entries.map(e => e.slug).filter(s => !replay.has(s))
    if (added.length > 0) from.push(k)
    for (const s of added) slugs.add(s)
  }
  return { keys: from, slugs: [...slugs] }
}

/** What a linking replay of the half loads: its keys and the others, the half's slugs (`replaySlugs`), and in a judged run its background (`backgroundOf`). */
export function linkReplayStories(files: readonly KeyFile[], half: LinkStepOptions['half']) {
  const { keys, others } = keysOfHalf(files, half)
  const background = half === 'judge' ? backgroundOf(keys, others) : { keys: [], slugs: [] }
  return { keys, others, slugs: replaySlugs(keys), background }
}

/**
 * The linking replay's desk estimate per story and run: the 2026-11-19 paid run of the judged half
 * spent $0.3047 on 3 runs of 209 stories, the link calls, the foundings and the end-event judge together.
 */
export const LINK_DESK_USD_PER_STORY = 0.0005

/** The re-center signals the sandbox's live link decisions kept, by slug. */
export function sandboxSignals(sandbox: Sandbox, slug: (id: string) => string): StorySignal[] {
  return sandbox.decisions.flatMap(d => {
    const inputs = d.kind === 'link' && !d.undone && d.storyId ? readInputs(linkInputs, d.inputs) : null
    return inputs ? inputs.signals.map(s => ({ slug: slug(d.storyId!), overviewId: s.overviewId, kind: s.kind })) : []
  })
}

export async function runLinkStep(o: LinkStepOptions): Promise<LinkStepReport> {
  const { keys, others, slugs, background } = linkReplayStories(o.files, o.half)
  const left: LinkStepReport['left'] = o.files
    .filter(f => !f.key || f.errors.length > 0)
    .map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))
  // A center's stories are replayed and its entries scored: none may be a draft no one checked
  const refused = awaitingReview(keys, 'centers')
  if (refused) {
    const score = scoreLinking(keys, [])
    return {
      half: o.half,
      repeat: o.repeat,
      keys: keys.map(k => k.id),
      stories: 0,
      background: { keys: [], stories: 0 },
      left,
      score,
      endEvents: [],
      signals: [],
      diagnostics: [],
      unanswered: 0,
      costUsd: 0,
      perStoryUsd: null,
      stopped: refused,
    }
  }
  // The half's stories and the background together, in one date order: a background story is a neighbour as in production
  const loaded = await o.stories([...slugs, ...background.slugs])
  const slugOf = new Map<string, string>()
  const stories: LinkStory[] = []
  for (const [slug, story] of loaded) {
    if (!story) left.push({ what: slug, reason: 'not published in this database' })
    else {
      slugOf.set(story.id, slug)
      stories.push(story)
    }
  }
  stories.sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime() || a.id.localeCompare(b.id))
  const replayed = o.limit !== undefined ? stories.slice(0, o.limit) : stories
  const ids = new Set(replayed.map(s => s.id))
  const byId = new Map(replayed.map(s => [s.id, s]))
  const spentBefore = o.ctx.spentUsd()
  let stopped: string | undefined
  // The calls given no answer because none was made (past the budget, or not cached with --cache-only)
  let unanswered = 0
  const ctx: LinkStepOptions['ctx'] = {
    ...o.ctx,
    call: async (a, schemaName, schema, prompt) => {
      const rec = await o.ctx.call(a, schemaName, schema, prompt)
      if (rec.outcome === 'skipped') unanswered++
      return rec
    },
  }
  const runs: ReplayRun[] = []
  const signalsOf = new Map<number, StorySignal[]>()
  const diagnosed: { run: number; overviews: FoundedOverview[]; traces: Map<string, StoryTrace> }[] = []
  for (const run of runNumbers(o.repeat)) {
    const sandbox = createSandbox()
    // What each story's last read of its neighbours gave, before and after keeping them to the replayed stories
    const counts = new Map<string, NeighbourCount>()
    const deps: LinkDeps = {
      neighbours: async s => {
        const all = await o.neighbours(s)
        const kept = all.filter(n => ids.has(n.id))
        counts.set(s.id, { read: all.length, near: all.filter(n => n.via === 'near').length, kept: kept.length })
        return kept
      },
      memberships: sandbox.memberships,
      overviews: sandbox.candidateOverviews,
      stories: async wanted => wanted.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])),
      ...evalCalls(ctx, run).link,
    }
    const ordered = await linkInOrder(replayed, deps, sandbox.apply, {
      concurrency: o.concurrency,
      keepGoing: async () => {
        if (o.ctx.spentUsd() < o.budgetUsd) return true
        stopped ??= `the budget ran out in run ${run}: the stories after it were not linked`
        return false
      },
    })
    const slug = (id: string) => slugOf.get(id) ?? id
    runs.push({
      run,
      overviews: [...sandbox.overviews.values()].map(ov => ({
        id: ov.id,
        members: ov.entries.map(e => slug(e.storyId)),
        foundedFrom: [slug(ov.foundedFrom[0]), slug(ov.foundedFrom[1])],
        endEvent: ov.charter.endEvent,
      })),
      roles: new Map([...sandbox.results].flatMap(([id, r]) => (r.role ? [[slug(id), r.role] as const] : []))),
    })
    signalsOf.set(run, sandboxSignals(sandbox, slug))
    diagnosed.push({
      run,
      overviews: [...sandbox.overviews.values()].map(ov => ({
        id: ov.id,
        title: ov.title,
        charter: ov.charter,
        foundedFrom: [slug(ov.foundedFrom[0]), slug(ov.foundedFrom[1])],
        foundedOn: byId.get(ov.foundedFrom[1])?.date ?? '',
        members: ov.entries.map(e => slug(e.storyId)),
      })),
      traces: new Map(
        ordered.results.map(r => [slug(r.story.id), traceOf(r, sandbox.results.get(r.story.id)?.outcome ?? null, counts.get(r.story.id) ?? null, slug)]),
      ),
    })
    if (stopped) break
  }

  // The strong judge on each development's founded end event, per run: only where the founding names one
  const provisional = scoreLinking(keys, runs, new Map(), others)
  const endEvents: LinkStepReport['endEvents'] = []
  for (const r of provisional.runs) {
    const run = runs.find(x => x.run === r.run)!
    for (const k of keys) {
      const overviewId = r.developments.get(k.id)
      const founded = run.overviews.find(ov => ov.id === overviewId)
      if (!founded) {
        endEvents.push({ key: k.id, run: r.run, verdict: null, why: 'no overview of it was founded' })
        continue
      }
      if (founded.endEvent === null) {
        endEvents.push({ key: k.id, run: r.run, verdict: 'none', why: 'founded with no end event: it closes by fading' })
        continue
      }
      // A key that names no end event shows the judge none: a founding that names one is then judged against it
      const prompt = buildEndEventJudgePrompt({ development: k.title, key: k.charter.endEvent ?? 'none (it ends by fading)', founded: founded.endEvent })
      const answer = await evalCall(ctx, JUDGE_ARM, END_EVENT_SCHEMA, endEventJudgeSchema, prompt, r.run)
      endEvents.push({
        key: k.id,
        run: r.run,
        verdict: answer.parsed ? (answer.parsed.same === 'yes' ? 'right' : 'wrong') : 'unjudged',
        why: answer.parsed?.why ?? 'the judge gave no answer',
      })
    }
  }
  const verdicts = new Map(keys.map(k => [k.id, runs.map(r => endEvents.find(e => e.key === k.id && e.run === r.run)?.verdict ?? null)]))
  const replayedSlugs = new Set(replayed.map(s => slugOf.get(s.id) ?? s.id))
  const costUsd = o.ctx.spentUsd() - spentBefore
  return {
    half: o.half,
    repeat: o.repeat,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    keys: keys.map(k => k.id),
    stories: replayed.length,
    background: { keys: background.keys.map(k => k.id), stories: background.slugs.filter(s => replayedSlugs.has(s)).length },
    left,
    score: scoreLinking(keys, runs, verdicts, others),
    endEvents,
    signals: provisional.runs.map(r => scoreSignals(keys, replayedSlugs, signalsOf.get(r.run) ?? [], r.developments, r.run)),
    diagnostics: diagnosed.map(x =>
      diagnoseRun({
        keys,
        others,
        run: x.run,
        overviews: x.overviews,
        traces: x.traces,
        roles: runs.find(r => r.run === x.run)!.roles,
        replayed: replayedSlugs,
        neighbourLimit: config.overviews.neighbourLimit,
      }),
    ),
    unanswered,
    costUsd,
    perStoryUsd: replayed.length === 0 || runs.length === 0 ? null : costUsd / (replayed.length * runs.length),
    ...(stopped ? { stopped } : {}),
  }
}
