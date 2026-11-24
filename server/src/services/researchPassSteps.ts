/**
 * A research pass's steps (`.context/research-passes.md`, "The steps"): their names (research's,
 * context's under their pass names, the later pass's judge, update and note), the tier each starts
 * on, the effort an extraction step runs at, and the one metered caller a pass makes its calls
 * through (`passCaller`). Pure: the call itself is injected, as `researchStory`'s is.
 */
import type { z } from 'zod'
import { config, type ReasoningEffort } from '../config.js'
import type { Prompt } from '../lib/promptCache.js'
import { unescapeXmlDeep } from '../lib/xml.js'
import { LATER_STEP_TIERS, LATER_STEPS, type LaterCall } from './researchPassLater.js'
import { STEP_TIERS, STEPS, type ResearchCall, type StepResult } from './researchPipeline.js'
import { CONTEXT_STEP_TIERS, type ContextCall, type ContextStep } from './storyContextPipeline.js'

/** Context's steps as a pass names them, apart from research's steps of the same name. */
export const CARD_STEPS = {
  structure: 'structure',
  'gap-list': 'gap-list',
  'gap-extract': 'extract',
  'figure-check': 'figure-check',
  'facts-check': 'fact-check',
  'cards-write': 'write',
  'box-check': 'box-check',
} as const satisfies Record<string, ContextStep>

export type CardStep = keyof typeof CARD_STEPS

/** Research's steps, context's under their pass names, and the later pass's judge, update and note. */
export const PASS_STEPS = [...STEPS, ...(Object.keys(CARD_STEPS) as CardStep[]), ...LATER_STEPS] as const
export type PassStep = (typeof PASS_STEPS)[number]

/** A context step's pass name. */
export const CARD_STEP_OF = Object.fromEntries(Object.entries(CARD_STEPS).map(([pass, step]) => [step, pass])) as Record<ContextStep, CardStep>

/** The tier each step starts on: research's and context's as they are, the later pass's medium; the eval moves a step up. */
export const PASS_STEP_TIERS: Record<PassStep, 'small' | 'medium'> = {
  ...STEP_TIERS,
  ...(Object.fromEntries(Object.entries(CARD_STEPS).map(([pass, step]) => [pass, CONTEXT_STEP_TIERS[step]])) as Record<CardStep, 'small' | 'medium'>),
  ...LATER_STEP_TIERS,
}

/** The steps that only copy what a source states into fields: they run at `config.research.extractionEffort`. */
export const EXTRACTION_STEPS: ReadonlySet<PassStep> = new Set<PassStep>(['extract', 'gap-extract', 'structure'])

/** A step's reasoning effort on its tier's model: the extraction effort for an extraction step, else the tier's own (undefined). */
export const passStepEffort = (step: PassStep): ReasoningEffort | undefined => (EXTRACTION_STEPS.has(step) ? config.research.extractionEffort : undefined)

/** One metered structured-output call for a step; a `skipped` outcome means the budget is used up. */
export type PassCall = <T>(step: PassStep, schema: z.ZodType<T>, prompt: Prompt) => Promise<StepResult<T> & { transient?: boolean }>

/**
 * A pass's one metered caller, under the signature each part of the pass calls with: research's
 * steps, context's under their pass names, and the later pass's (its parsed answer unescaped). It
 * notes what every call came to: whether the budget skipped one, and whether the last call that
 * failed may pass on a second attempt.
 */
export interface PassCaller {
  research: ResearchCall
  cards: ContextCall
  later: LaterCall
  /** A call was skipped: the budget is used up. */
  readonly budget: boolean
  /** The last call that failed may pass on a second attempt. */
  readonly lastTransient: boolean
  /** Forget the failures so far: a later pass's technical failure is that of a call its article step made. */
  forgetFailure(): void
}

export function passCaller(call: PassCall): PassCaller {
  let budget = false
  let lastTransient = false
  const noted = async <T>(step: PassStep, schema: z.ZodType<T>, prompt: Prompt) => {
    const res = await call(step, schema, prompt)
    if (res.outcome === 'skipped') budget = true
    else if (res.outcome !== 'ok') lastTransient = res.transient === true
    return res
  }
  return {
    research: (step, schema, prompt) => noted(step, schema, prompt),
    cards: ((step: ContextStep, schema: z.ZodType<unknown>, prompt: Prompt) => noted(CARD_STEP_OF[step], schema, prompt)) as ContextCall,
    later: async (step, schema, prompt) => {
      const { transient: _transient, ...res } = await noted(step, schema, prompt)
      return { ...res, parsed: res.outcome === 'ok' ? unescapeXmlDeep(res.parsed) : null }
    },
    get budget() {
      return budget
    },
    get lastTransient() {
      return lastTransient
    },
    forgetFailure() {
      lastTransient = false
    },
  }
}
