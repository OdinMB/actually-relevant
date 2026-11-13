/**
 * eval:research's adapter to production's research pipeline (`services/researchPipeline.ts`): the
 * eval runs the very steps the admin action runs, with its own step caller. Each step's tier maps to
 * a constant arm (never read from `config`, as in the rest of the eval), and calls go through the
 * eval context (cache, ledger, budget, semaphore) under versioned schema names. Also the eval-only
 * desk estimate per step.
 */
import { dedupConfirmationSchema } from '../../../schemas/llm.js'
import { deriveSchema, earlierSchema, extractionSchema, factCheckSchema, queriesSchema, repairSchema, writeSchema } from '../../../schemas/research.js'
import type { ResearchStory } from '../../../services/researchInput.js'
import {
  researchStory,
  STEP_TIERS,
  STEPS,
  type ResearchCall,
  type ResearchSearchAnswer,
  type StepName,
  type StoryResearch,
} from '../../../services/researchPipeline.js'
import { arm, versionedSchemaName } from '../models.js'
import type { Arm, SuiteContext } from '../types.js'
import type { TavilySearch } from './tavily.js'

export { STEPS }
export type { DropKind, ResearchEarlier, ResearchSource, StepCall, StepName, StoryResearch } from '../../../services/researchPipeline.js'

/** Production's tier defaults today, as constants. */
export const SMALL = arm('gpt-6-luna', 'low')
export const MEDIUM = arm('gpt-6-luna', 'medium')

const TIER_ARMS: Record<(typeof STEP_TIERS)[StepName], Arm> = { small: SMALL, medium: MEDIUM }

export const STEP_ARMS = Object.fromEntries(STEPS.map(step => [step, TIER_ARMS[STEP_TIERS[step]]])) as Record<StepName, Arm>

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
 * whole-draft rewrite, not yet measured) and the derived fields written again (`derive`, with its check).
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
}

const SCHEMA_NAMES = {
  confirm: versionedSchemaName('research-confirm', dedupConfirmationSchema),
  queries: versionedSchemaName('research-queries', queriesSchema),
  extract: versionedSchemaName('research-extract', extractionSchema),
  earlier: versionedSchemaName('research-earlier', earlierSchema),
  write: versionedSchemaName('research-write', writeSchema),
  'fact-check': versionedSchemaName('research-fact-check', factCheckSchema),
  rewrite: versionedSchemaName('research-repair', repairSchema),
  derive: versionedSchemaName('research-derive', deriveSchema),
} satisfies Record<StepName, string>

export interface EvalResearchDeps {
  ctx: SuiteContext
  tavily: { search(request: TavilySearch): Promise<ResearchSearchAnswer> }
  /** Publish bar for the gate (`config.selection.relevanceMin`). */
  relevanceMin: number
  /** The fixtures' sampling time; caps the search window's end. */
  latestDate?: string
}

/** Runs production's research steps for one story through the eval context. Never throws. */
export function researchStoryInEval(story: ResearchStory, d: EvalResearchDeps): Promise<StoryResearch> {
  const call: ResearchCall = async (step, schema, prompt) => {
    const a = STEP_ARMS[step]
    const rec = await d.ctx.call(a, SCHEMA_NAMES[step], schema, prompt)
    return { parsed: rec.outcome === 'ok' ? rec.parsed : null, outcome: rec.outcome, usage: rec.usage, costUsd: rec.costUsd, model: a.model }
  }
  return researchStory(story, { call, tavily: d.tavily, relevanceMin: d.relevanceMin, latestDate: d.latestDate })
}
