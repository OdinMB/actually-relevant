/**
 * The `context` step of `eval:overviews` (plan `.plans/2026-11-16_story-context.md`, "Eval gate
 * before switching on"): production's `buildStoryContext` on each gap key's story, `--repeat` times,
 * then the strong judge on what it kept (`contextJudge.ts`) and the scores against the bars
 * (`contextScore.ts`).
 *
 * The eval deps: each step's tier on a constant arm (research's `SMALL` and `MEDIUM`, production's
 * tier defaults as constants), calls through the eval context (cache, ledger, budget) under
 * versioned schema names, run k ≥ 2 under its own cache key (`repeats.ts`); search through the
 * eval's cached Tavily client, the request built by production's `tavilyRequestFor` (so it ends on
 * the story's publication day) and each result shaped by `searchResultFrom`; no opt-out policy
 * (recorded as `optOutChecked: false`, as eval:research). A search answered from the eval's cache
 * counts the credits it cost when made, so a story's cost is what production would pay without its
 * own 7-day cache. Each search's result dates are logged for the replay's hindsight check. Stories
 * start only while the budget covers one more (`runStories`); the judge runs only when its planned
 * calls fit what is left (`callBudget.ts`).
 */
import type { z } from 'zod'
import {
  buildStoryContext,
  CONTEXT_STEP_TIERS,
  type ContextCall,
  type ContextDeps,
  type ContextInput,
  type ContextStep,
} from '../../../services/storyContextPipeline.js'
import { searchResultFrom, tavilyRequestFor } from '../../../services/storyContextSources.js'
import { versionedSchemaName } from '../models.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import { MEDIUM, SMALL } from '../research/pipeline.js'
import { runStories, type SkippedStory } from '../research/storyQueue.js'
import type { TavilyResponse, TavilySearch } from '../research/tavily.js'
import type { Arm, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate, type Ledger } from './callBudget.js'
import { judgeContext, plannedJudgeCalls, type JudgedRun } from './contextJudge.js'
import {
  inHalf,
  resultDates,
  scoreContext,
  scoreFields,
  type ContextScore,
  type FieldScore,
  type Half,
  type ResultDates,
  type SearchLogEntry,
  type StoryRun,
} from './contextScore.js'
import type { GapKey } from './gapKeySchema.js'
import type { GapKeyFile } from './keyFiles.js'

/** Production's tier defaults today, as constants (the arms eval:research runs research's steps on). */
export const CONTEXT_STEP_ARMS: Record<ContextStep, Arm> = Object.fromEntries(
  (Object.keys(CONTEXT_STEP_TIERS) as ContextStep[]).map(step => [step, CONTEXT_STEP_TIERS[step] === 'medium' ? MEDIUM : SMALL]),
) as Record<ContextStep, Arm>

/** What one story's run may cost, reserved while it runs: the step's own bound (3 searches, 5 extractions, about 7 calls). */
export const CONTEXT_STORY_RESERVE_USD = 0.1
/** A desk estimate of the strong judge per story and run, for the dry run only: the real gate prices its planned calls. */
export const JUDGE_DESK_USD_PER_RUN = 0.1

const names = new Map<string, string>()

/** `overview-context-<step>#<schema fingerprint>`, computed once per step. */
function schemaNameOf(step: ContextStep, schema: z.ZodType): string {
  let name = names.get(step)
  if (name === undefined) {
    name = versionedSchemaName(`overview-context-${step}`, schema)
    names.set(step, name)
  }
  return name
}

/** Production's step caller for the eval: the step's constant arm, the eval context, run k's cache key. */
export function contextCall(ctx: SuiteContext, run: number): ContextCall {
  return async (step, schema, prompt) => {
    const a = CONTEXT_STEP_ARMS[step]
    const rec = await ctx.call(a, runSchemaName(schemaNameOf(step, schema), run), schema, prompt)
    return { parsed: rec.outcome === 'ok' ? rec.parsed : null, outcome: rec.outcome, usage: rec.usage, costUsd: rec.costUsd, model: a.model }
  }
}

export interface SearchClient {
  search(request: TavilySearch): Promise<TavilyResponse>
}

/** Production's search request on the eval's cached client; each answer's result dates go to `log`. */
export function evalSearch(tavily: SearchClient, log: (entry: Pick<SearchLogEntry, 'endDate' | 'dates'>) => void): ContextDeps['search'] {
  return async request => {
    const answer = await tavily.search(tavilyRequestFor(request))
    log({ endDate: request.endDate, dates: answer.results.map(r => r.publishedDate) })
    return { results: answer.results.map(searchResultFrom), credits: answer.credits, cached: false }
  }
}

/** One gap key's story with its input, as the step runs it. */
export interface ContextStory {
  slug: string
  key: GapKey
  input: ContextInput
}

export interface PipelineOptions {
  ctx: SuiteContext
  tavily: SearchClient
  repeat: number
  concurrency: number
  budgetUsd: number
  /** The folder's spend so far: model ledger plus Tavily credits. */
  spentUsd: () => number
  onDone?: (run: JudgedRun) => void
}

export interface PipelineRuns {
  /** Run 1's stories first, each run in story order. */
  runs: JudgedRun[]
  /** `storyId` is `<slug>#<run>`. */
  skipped: SkippedStory[]
  searches: SearchLogEntry[]
}

/** Production's pipeline on every story, run 1 for all of them before run 2. */
export async function runPipeline(stories: ContextStory[], o: PipelineOptions): Promise<PipelineRuns> {
  const out: PipelineRuns = { runs: [], skipped: [], searches: [] }
  for (const run of runNumbers(o.repeat)) {
    const done = await runStories(
      stories.map(s => ({ id: `${s.slug}#${run}`, story: s })),
      {
        concurrency: o.concurrency,
        budgetUsd: o.budgetUsd,
        spentUsd: o.spentUsd,
        storyUsd: () => CONTEXT_STORY_RESERVE_USD,
        run: async ({ story }): Promise<JudgedRun> => {
          const deps: ContextDeps = {
            call: contextCall(o.ctx, run),
            search: evalSearch(o.tavily, e => out.searches.push({ slug: story.slug, run, ...e })),
          }
          return { slug: story.slug, run, key: story.key, input: story.input, result: await buildStoryContext(story.input, deps) }
        },
        onDone: (_item, r) => o.onDone?.(r),
      },
    )
    out.runs.push(...done.results)
    out.skipped.push(...done.skipped)
  }
  return out
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/** Which keys the step runs: those without errors, in `--half`, in file order, the first `--limit`; and why each other key is left out. */
export function chooseKeys(files: GapKeyFile[], half: Half | 'all', limit?: number): { keys: GapKey[]; left: { file: string; reason: string }[] } {
  const left: { file: string; reason: string }[] = []
  const keys: GapKey[] = []
  for (const f of files) {
    if (!f.key || f.errors.length > 0) left.push({ file: f.file, reason: `${f.errors.length} format errors: fix the key` })
    else if (inHalf(f.key.slug, half)) keys.push(f.key)
  }
  return { keys: limit === undefined ? keys : keys.slice(0, limit), left }
}

export interface ContextStepOptions extends Omit<PipelineOptions, 'ctx' | 'spentUsd'> {
  ctx: SuiteContext & Ledger
  files: GapKeyFile[]
  half: Half | 'all'
  limit?: number
  /** The stories' inputs by slug (`contextInputsFor`). */
  inputs(slugs: string[]): Promise<Map<string, ContextInput | null>>
  /** Whether uncached model calls can reach the API (the judge's gate). */
  canCall: boolean
  dryRun: boolean
}

export interface ContextStepReport {
  half: Half | 'all'
  repeat: number
  limit?: number
  /** The keys chosen, before their inputs were loaded. */
  keys: number
  /** Keys left out: format errors, or a story with no input. */
  left: { file: string; reason: string }[]
  /** Stories the pipeline ran on. */
  stories: number
  /** Dry run: the desk estimate of the pipeline and the judge; null once the step ran. */
  deskUsd: number | null
  skipped: SkippedStory[]
  judge: { estimate: CallEstimate; stopped: string | null } | null
  score: ContextScore
  fields: FieldScore
  dates: ResultDates
}

export interface ContextStepRun {
  report: ContextStepReport
  /** Every story run of the pipeline, in `runPipeline`'s order: `--facts context` samples run 1's facts. */
  runs: JudgedRun[]
}

const unjudged = (r: JudgedRun): StoryRun => ({ slug: r.slug, run: r.run, key: r.key, result: r.result, needs: null, items: null, notes: null })

/** The step: the keys' stories, production's pipeline on each, then the judge when its calls fit. */
export async function runContextStep(o: ContextStepOptions): Promise<ContextStepRun> {
  const chosen = chooseKeys(o.files, o.half, o.limit)
  const inputs = chosen.keys.length === 0 ? new Map<string, ContextInput | null>() : await o.inputs(chosen.keys.map(k => k.slug))
  const left = [...chosen.left]
  const stories: ContextStory[] = []
  for (const key of chosen.keys) {
    const input = inputs.get(key.slug) ?? null
    if (input) stories.push({ slug: key.slug, key, input })
    else left.push({ file: `${key.slug}.json`, reason: 'no input: the story is not published or has no research run whose sources hold facts' })
  }
  const base = { half: o.half, repeat: o.repeat, ...(o.limit !== undefined ? { limit: o.limit } : {}), keys: chosen.keys.length, left, stories: stories.length }
  if (o.dryRun) {
    const deskUsd = stories.length * o.repeat * (CONTEXT_STORY_RESERVE_USD + JUDGE_DESK_USD_PER_RUN)
    return { report: { ...base, deskUsd, skipped: [], judge: null, score: scoreContext([]), fields: scoreFields([]), dates: resultDates([]) }, runs: [] }
  }

  const pipeline = await runPipeline(stories, { ...o, spentUsd: () => o.ctx.spentUsd() })
  const gate: CallGate = { budgetUsd: o.budgetUsd, canCall: o.canCall }
  const estimate = estimateCalls(o.ctx, plannedJudgeCalls(pipeline.runs))
  const stopped = refusal(estimate, o.ctx, gate)
  const judged = stopped ? { stories: pipeline.runs.map(unjudged), fields: [] } : await judgeContext(o.ctx, pipeline.runs)
  return {
    report: {
      ...base,
      deskUsd: null,
      skipped: pipeline.skipped,
      judge: { estimate, stopped },
      score: scoreContext(judged.stories),
      fields: scoreFields(judged.fields),
      dates: resultDates(pipeline.searches),
    },
    runs: pipeline.runs,
  }
}
