/**
 * The eval's adapter to production's research pass (`services/researchPass.ts`): eval:research and
 * `eval:overviews --steps context` run the very steps a first pass runs, with the eval's own step
 * caller. Each step's tier maps to a constant arm (never read from `config`, as in the rest of the
 * eval), and calls go through the eval context (cache, ledger, budget, semaphore) under versioned
 * schema names: research's steps under research's, the card steps under the context step's
 * (`overview-context-<step>`), so both evals ask the cache alike; run k ≥ 2 under its own cache key
 * (`repeats.ts`). Gap searches go through the eval's cached Tavily client, the request built by
 * production's `tavilyRequestFor` and each result shaped by `searchResultFrom`; no opt-out policy
 * (recorded as `optOutChecked: false`). Also the eval-only desk estimate per step.
 */
import type { z } from 'zod'
import { dedupConfirmationSchema } from '../../../schemas/llm.js'
import {
  coverageExtractionSchema,
  deriveSchema,
  earlierSchema,
  extractionSchema,
  factCheckSchema,
  queriesSchema,
  repairSchema,
  writeSchema,
} from '../../../schemas/research.js'
import { judgeSchema, noteSchema } from '../../../schemas/researchPass.js'
import type { ResearchStory } from '../../../services/researchInput.js'
import { runResearchPass, type PassDeps, type PassInput, type PassResult } from '../../../services/researchPass.js'
import { passCalls } from '../../../services/researchPassRecord.js'
import { CARD_STEPS, PASS_STEP_TIERS, passStepEffort, PASS_STEPS, type CardStep, type PassCall, type PassStep } from '../../../services/researchPassSteps.js'
import type { StepName as ResearchStep, StoryResearch as PassResearch } from '../../../services/researchPipeline.js'
import { EMPTY_POOL } from '../../../services/researchPool.js'
import { storyLayout } from '../../../services/storyContextLayout.js'
import { searchResultFrom, tavilyRequestFor } from '../../../services/storyContextSources.js'
import { arm, versionedSchemaName } from '../models.js'
import { runSchemaName } from '../repeats.js'
import type { Arm, SuiteContext } from '../types.js'
import type { TavilyResponse, TavilySearch } from './tavily.js'

/** Every step of a first pass: research's, then the card steps. */
export const STEPS = PASS_STEPS
export type StepName = PassStep
export type StepCall = ReturnType<typeof passCalls>[number]
/** One first pass as eval:research reads it: research's record, with every call the pass made and the whole pass's credits. */
export type StoryResearch = Omit<PassResearch, 'calls'> & { calls: StepCall[] }
export type { DropKind, ResearchEarlier, ResearchSource } from '../../../services/researchPipeline.js'

/** Production's tier defaults today, as constants. */
export const SMALL = arm('gpt-6-luna', 'low')
export const MEDIUM = arm('gpt-6-luna', 'medium')

const TIER_ARMS: Record<(typeof PASS_STEP_TIERS)[StepName], Arm> = { small: SMALL, medium: MEDIUM }

/** Each step's tier arm, an extraction step at production's extraction effort on its tier's model (`passStepEffort`). */
export const STEP_ARMS = Object.fromEntries(
  STEPS.map(step => {
    const tierArm = TIER_ARMS[PASS_STEP_TIERS[step]]
    const effort = passStepEffort(step)
    return [step, effort ? arm(tierArm.model, effort) : tierArm]
  }),
) as Record<StepName, Arm>

export interface StepEstimate {
  /** Tokens per researched story; output includes reasoning. */
  input: number
  output: number
  /** A row of the design's desk estimate ("Model cost: desk estimate, then measurement"). */
  inDesign: boolean
}

/**
 * The design's desk estimate per story, plus the calls it has no row for: the neighbour
 * confirmation, a repair round (`rewrite`, counted here with its fact check; sized for the old
 * whole-draft rewrite, not yet measured), the derived fields written again (`derive`, with its
 * check), and the card steps at the research passes plan's estimate (a structure call, the gap
 * list, about 5 gap extractions, 3 fact-check calls over 50 to 60 facts, the card write and check).
 */
export const STEP_ESTIMATES: Record<StepName, StepEstimate> = {
  confirm: { input: 1500, output: 500, inDesign: false },
  queries: { input: 2000, output: 500, inDesign: true },
  extract: { input: 15000, output: 10000, inDesign: true },
  earlier: { input: 3000, output: 500, inDesign: true },
  write: { input: 12000, output: 4500, inDesign: true },
  'fact-check': { input: 5000, output: 1000, inDesign: true },
  rewrite: { input: 17000, output: 5500, inDesign: false },
  derive: { input: 3000, output: 2000, inDesign: false },
  structure: { input: 5000, output: 1500, inDesign: false },
  'gap-list': { input: 4000, output: 1000, inDesign: false },
  'gap-extract': { input: 15000, output: 10000, inDesign: false },
  'facts-check': { input: 18000, output: 4500, inDesign: false },
  'cards-write': { input: 10000, output: 3000, inDesign: false },
  'box-check': { input: 5000, output: 1500, inDesign: false },
  // A later pass's article step: the plan's "with rewrite" row less its checks, which count under fact-check
  judge: { input: 6000, output: 1500, inDesign: false },
  update: { input: 12000, output: 3000, inDesign: false },
  note: { input: 2500, output: 400, inDesign: false },
}

/** The later pass's steps: neither research's nor a card step. */
type LaterStep = Exclude<StepName, ResearchStep | CardStep>

/** The later pass's steps, under their own names. */
const LATER_SCHEMA_NAMES = {
  judge: versionedSchemaName('pass-judge', judgeSchema),
  update: versionedSchemaName('pass-update', repairSchema),
  note: versionedSchemaName('pass-note', noteSchema),
} satisfies Record<LaterStep, string>

const RESEARCH_SCHEMA_NAMES = {
  ...LATER_SCHEMA_NAMES,
  confirm: versionedSchemaName('research-confirm', dedupConfirmationSchema),
  queries: versionedSchemaName('research-queries', queriesSchema),
  extract: versionedSchemaName('research-extract', extractionSchema),
  earlier: versionedSchemaName('research-earlier', earlierSchema),
  write: versionedSchemaName('research-write', writeSchema),
  'fact-check': versionedSchemaName('research-fact-check', factCheckSchema),
  rewrite: versionedSchemaName('research-repair', repairSchema),
  derive: versionedSchemaName('research-derive', deriveSchema),
} satisfies Record<ResearchStep | LaterStep, string>

const COVERAGE_EXTRACT_SCHEMA_NAME = versionedSchemaName('research-extract-structured', coverageExtractionSchema)

const cardNames = new Map<CardStep, string>()

const isCardStep = (step: StepName): step is CardStep => Object.hasOwn(CARD_STEPS, step)

/** Research's step under research's name, a later pass's under `pass-<step>`; a card step under its context step's, `overview-context-<step>#<schema fingerprint>`, computed once. */
function schemaNameOf(step: StepName, schema: z.ZodType): string {
  // A pass's extraction asks for the structured fields too: its own schema, under its own name
  if (step === 'extract' && schema === coverageExtractionSchema) return COVERAGE_EXTRACT_SCHEMA_NAME
  if (!isCardStep(step)) return RESEARCH_SCHEMA_NAMES[step]
  let name = cardNames.get(step)
  if (name === undefined) {
    name = versionedSchemaName(`overview-context-${CARD_STEPS[step]}`, schema)
    cardNames.set(step, name)
  }
  return name
}

/** Production's step caller for the eval: the step's constant arm, the eval context, run k's cache key. */
export function passCall(ctx: SuiteContext, run = 1): PassCall {
  return async (step, schema, prompt) => {
    const a = STEP_ARMS[step]
    const rec = await ctx.call(a, runSchemaName(schemaNameOf(step, schema), run), schema, prompt)
    return { parsed: rec.outcome === 'ok' ? rec.parsed : null, outcome: rec.outcome, usage: rec.usage, costUsd: rec.costUsd, model: a.model }
  }
}

export interface SearchClient {
  search(request: TavilySearch): Promise<TavilyResponse>
}

/** What a gap search found, for the replay's hindsight check. */
export interface SearchLog {
  /** `YYYY-MM-DD`. */
  endDate: string
  dates: (string | null)[]
}

/**
 * Production's gap search request on the eval's cached client, each answer's result dates to `log`.
 * A cached answer counts the credits it cost when made, so a story's cost is what production would
 * pay without its own 7-day cache.
 */
export function evalSearch(tavily: SearchClient, log: (entry: SearchLog) => void = () => {}): PassDeps['search'] {
  return async request => {
    const answer = await tavily.search(tavilyRequestFor(request))
    log({ endDate: request.endDate, dates: answer.results.map(r => r.publishedDate) })
    return { results: answer.results.map(searchResultFrom), credits: answer.credits, cached: false }
  }
}

/**
 * A first pass's input from a research fixture alone: an empty pool, no version, the assessed text as
 * the story's places (the fixtures do not hold the research column), and no earlier stories' facts.
 */
export function firstPassInput(story: ResearchStory): PassInput {
  const p = story.published
  return {
    passId: `eval-${story.id}`,
    story,
    pool: EMPTY_POOL,
    version: null,
    lastPassDay: null,
    carried: [],
    plan: null,
    // The story's own day: a first pass's window is research's, around the article
    today: story.datePublished.slice(0, 10),
    current: {
      title: p.title,
      summary: p.summary,
      layout: storyLayout({
        url: story.original.url,
        summary: p.summary,
        relevanceReasons: p.whyThisMatters || null,
        antifactors: p.caveats || null,
        research: null,
      }),
    },
    storyDay: story.datePublished.slice(0, 10),
    reusable: [],
  }
}

export interface EvalPassDeps {
  ctx: SuiteContext
  tavily: SearchClient
  /** Publish bar for the gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  /** Caps the coverage window's end: the fixtures' sampling time, or a replayed story's day. */
  latestDate?: string
  run?: number
  log?: (entry: SearchLog) => void
}

/** Production's first pass on one input through the eval context. Never throws. */
export function passInEval(input: PassInput, d: EvalPassDeps): Promise<PassResult> {
  return runResearchPass(input, {
    call: passCall(d.ctx, d.run),
    tavily: d.tavily,
    search: evalSearch(d.tavily, d.log),
    relevanceMin: d.relevanceMin,
    latestDate: d.latestDate,
  })
}

/** eval:research's run of one story: production's first pass, read as research's record. Never throws. */
export async function researchStoryInEval(story: ResearchStory, d: EvalPassDeps): Promise<StoryResearch> {
  const result = await passInEval(firstPassInput(story), d)
  return { ...result.record.research, verdict: result.verdict, calls: passCalls(result.record), credits: result.credits }
}
