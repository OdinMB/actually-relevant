/**
 * The overview linking steps, `link`, `found` and `role` (`.context/model-eval.md`, "Overview evals";
 * plan "Evals and bars"): one replay serves all three. The answer keys of a half (`developmentHalves.ts`)
 * give their entries and near misses, replayed together in date order through production's pure
 * linking (`linkInOrder`, `linkStory`) against the in-memory sandbox (`overviewSandbox.ts`), with
 * production's prompts on the eval's cached calls at the step tiers. Neighbours come from production's
 * candidate query, read-only and as of each story's date, kept to the replayed stories; the stories as
 * linking reads them. Then the strong judge compares each development's founded end event with the
 * key's, and `linkScore.ts` scores the bars. Each run k ≥ 2 has its own cache keys.
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
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { scoreLinking, type EndEventVerdict, type LinkScore, type ReplayRun } from './linkScore.js'
import { createSandbox } from './overviewSandbox.js'
import { buildEndEventJudgePrompt, endEventJudgeSchema } from './prompts.js'

/** Production's step tiers today, as the eval's arms (the overview steps' evals all take theirs from here). */
export const TIER_ARMS: Record<'small' | 'medium' | 'large', Arm> = {
  small: arm('gpt-6-luna', 'low'),
  medium: arm('gpt-6-luna', 'medium'),
  large: arm('gpt-6.1-sol', 'medium'),
}
/** A step's arm: its tier's, at the step's own effort where it has one (the audit's). */
export const stepArm = (step: OverviewStep<unknown>): Arm => ({ ...TIER_ARMS[step.tier], ...(step.effort ? { effort: step.effort } : {}) })

const END_EVENT_SCHEMA = versionedSchemaName('overview-end-event-judge', endEventJudgeSchema)

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
  /** The keys replayed, and the stories (entries and near misses). */
  keys: string[]
  stories: number
  left: { what: string; reason: string }[]
  score: LinkScore
  endEvents: { key: string; run: number; verdict: EndEventVerdict; why: string }[]
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

/** Every slug the half's keys replay: entries (must and optional) and near misses, once. */
export function replaySlugs(keys: readonly AnswerKey[]): string[] {
  return [...new Set(keys.flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug)]))]
}

export async function runLinkStep(o: LinkStepOptions): Promise<LinkStepReport> {
  const keys = o.files.flatMap(f => (f.key && f.errors.length === 0 && inDevelopmentHalf(f.key.id, o.half) ? [f.key] : []))
  const left: LinkStepReport['left'] = o.files
    .filter(f => !f.key || f.errors.length > 0)
    .map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))
  const loaded = await o.stories(replaySlugs(keys))
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
  const runs: ReplayRun[] = []
  for (const run of runNumbers(o.repeat)) {
    const sandbox = createSandbox()
    const deps: LinkDeps = {
      neighbours: async s => (await o.neighbours(s)).filter(n => ids.has(n.id)),
      memberships: sandbox.memberships,
      overviews: sandbox.candidateOverviews,
      stories: async wanted => wanted.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])),
      ...evalCalls(o.ctx, run).link,
    }
    await linkInOrder(replayed, deps, sandbox.apply, {
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
    if (stopped) break
  }

  // The strong judge on each development's founded end event, per run: only where the founding names one
  const provisional = scoreLinking(keys, runs)
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
      const prompt = buildEndEventJudgePrompt({ development: k.title, key: k.charter.endEvent, founded: founded.endEvent })
      const answer = await evalCall(o.ctx, JUDGE_ARM, END_EVENT_SCHEMA, endEventJudgeSchema, prompt, r.run)
      endEvents.push({
        key: k.id,
        run: r.run,
        verdict: answer.parsed ? (answer.parsed.same === 'yes' ? 'right' : 'wrong') : 'unjudged',
        why: answer.parsed?.why ?? 'the judge gave no answer',
      })
    }
  }
  const verdicts = new Map(keys.map(k => [k.id, runs.map(r => endEvents.find(e => e.key === k.id && e.run === r.run)?.verdict ?? null)]))
  const costUsd = o.ctx.spentUsd() - spentBefore
  return {
    half: o.half,
    repeat: o.repeat,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    keys: keys.map(k => k.id),
    stories: replayed.length,
    left,
    score: scoreLinking(keys, runs, verdicts),
    endEvents,
    costUsd,
    perStoryUsd: replayed.length === 0 || runs.length === 0 ? null : costUsd / (replayed.length * runs.length),
    ...(stopped ? { stopped } : {}),
  }
}
