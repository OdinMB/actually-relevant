/**
 * The `context` step of `eval:overviews` (plan `.plans/2026-11-16_story-context.md`, "Eval gate
 * before switching on"; `.plans/2026-11-17_research-passes.md`, "Evals and the gate"): production's
 * first research pass (`runResearchPass`) on each gap key's story, `--repeat` times, then the strong
 * judge on the cards it kept (`contextJudge.ts`) and the scores against the bars (`contextScore.ts`).
 *
 * The eval deps are research/pipeline.ts's: each step on its tier's constant arm, calls through the
 * eval context under versioned schema names, run k ≥ 2 under its own cache key; the gap searches
 * through the eval's cached Tavily client as production builds them, each answer's result dates
 * logged for the replay's hindsight check; research's coverage window ends on the story's day, as
 * the gap searches do. The input is a first pass's (`loadFirstPassInput`), whatever the story's
 * history. Stories start only while the budget covers one more first pass (`runStories`); the judge
 * runs only when its planned calls fit what is left (`callBudget.ts`).
 */
import { cardsLayout, type PassInput, type PassResult } from '../../../services/researchPass.js'
import { cardFacts } from '../../../services/researchPool.js'
import type { StoryContextResult } from '../../../services/storyContextPipeline.js'
import { runNumbers } from '../repeats.js'
import { passInEval, type SearchClient } from '../research/pipeline.js'
import { runStories, type SkippedStory } from '../research/storyQueue.js'
import type { SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type CallGate, type Ledger } from './callBudget.js'
import { judgeContext, plannedJudgeCalls, type JudgedInput, type JudgedRun } from './contextJudge.js'
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

/** What one story's run may cost, reserved while it runs: a first pass's ceiling (production's `research.pass.firstPassUsd`, as a constant). */
export const FIRST_PASS_RESERVE_USD = 0.4
/** A desk estimate of the strong judge per story and run, for the dry run only: the real gate prices its planned calls. */
export const JUDGE_DESK_USD_PER_RUN = 0.1

/** One gap key's story with its first pass's input, as the step runs it. */
export interface ContextStory {
  slug: string
  key: GapKey
  input: PassInput
}

export interface PipelineOptions {
  ctx: SuiteContext
  tavily: SearchClient
  /** Publish bar for research's gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  repeat: number
  concurrency: number
  budgetUsd: number
  /** The folder's spend so far: model ledger plus Tavily credits. */
  spentUsd: () => number
  onDone?: (run: JudgedRun) => void
}

/**
 * A pass as the judges and scores read a context run: its kept cards, the pool's facts as context
 * reads them, the card steps' record, and the whole pass's cost (the cost bar is the first pass's).
 * A card failure is a failed run, a budget stop a skipped one.
 */
export function cardsResult(pass: PassResult): StoryContextResult {
  const failed = pass.status === 'failed' || pass.record.cards === 'failed'
  const stopped = pass.outcome === 'budget' || pass.record.cards === 'budget'
  return {
    status: failed ? 'failed' : stopped ? 'skipped' : 'completed',
    outcome: failed || stopped ? 'technical' : pass.boxes.length > 0 ? 'built' : 'none-kept',
    facts: cardFacts(pass.pool),
    boxes: pass.boxes,
    writer: pass.writer,
    credits: pass.credits,
    modelUsd: pass.modelUsd,
    record: pass.record.context,
    error: pass.error ?? pass.record.cardsError,
    transient: pass.transient,
  }
}

/** The story the cards were written for: version 1's title and places when the pass kept a draft, else the story's own. */
export function judgedInput(input: PassInput, pass: PassResult): JudgedInput {
  return { storyId: input.story.id, title: pass.version?.title ?? input.current.title, storyDay: input.storyDay, layout: cardsLayout(input, pass.version) }
}

export interface PipelineRuns {
  /** Run 1's stories first, each run in story order. */
  runs: JudgedRun[]
  /** `storyId` is `<slug>#<run>`. */
  skipped: SkippedStory[]
  searches: SearchLogEntry[]
}

/** Production's first pass on every story, run 1 for all of them before run 2. */
export async function runPipeline(stories: ContextStory[], o: PipelineOptions): Promise<PipelineRuns> {
  const out: PipelineRuns = { runs: [], skipped: [], searches: [] }
  for (const run of runNumbers(o.repeat)) {
    const done = await runStories(
      stories.map(s => ({ id: `${s.slug}#${run}`, story: s })),
      {
        concurrency: o.concurrency,
        budgetUsd: o.budgetUsd,
        spentUsd: o.spentUsd,
        storyUsd: () => FIRST_PASS_RESERVE_USD,
        run: async ({ story }): Promise<JudgedRun> => {
          const pass = await passInEval(story.input, {
            ctx: o.ctx,
            tavily: o.tavily,
            relevanceMin: o.relevanceMin,
            latestDate: story.input.storyDay,
            run,
            log: e => out.searches.push({ slug: story.slug, run, ...e }),
          })
          return { slug: story.slug, run, key: story.key, input: judgedInput(story.input, pass), result: cardsResult(pass) }
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
  /** The stories' first-pass inputs by slug (`loadPassInputsBySlug`, cached). */
  inputs(slugs: string[]): Promise<Map<string, PassInput | null>>
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
  const inputs = chosen.keys.length === 0 ? new Map<string, PassInput | null>() : await o.inputs(chosen.keys.map(k => k.slug))
  const left = [...chosen.left]
  const stories: ContextStory[] = []
  for (const key of chosen.keys) {
    const input = inputs.get(key.slug) ?? null
    if (input) stories.push({ slug: key.slug, key, input })
    else left.push({ file: `${key.slug}.json`, reason: 'no input: research cannot run on the story (not found, or not an assessed story)' })
  }
  const base = { half: o.half, repeat: o.repeat, ...(o.limit !== undefined ? { limit: o.limit } : {}), keys: chosen.keys.length, left, stories: stories.length }
  if (o.dryRun) {
    const deskUsd = stories.length * o.repeat * (FIRST_PASS_RESERVE_USD + JUDGE_DESK_USD_PER_RUN)
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
