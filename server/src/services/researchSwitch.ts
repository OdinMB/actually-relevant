/**
 * Research's switch (`.context/story-research.md`): research runs only with the Tavily
 * key set and every step's model priced, so its cost can be counted. Research runs, the research
 * step's queue and research passes (`researchPassQueue.ts`) all read it here, so none of them needs
 * the others' modules for it. Reads config only.
 */
import { config } from '../config.js'
import { hasPrice } from './researchCost.js'
import { STEP_TIERS, STEPS, type StepName } from './researchPipeline.js'

/** The model id each research step runs on now: what a run stores beside its result. */
export function stepModels(): Record<StepName, string> {
  return Object.fromEntries(STEPS.map(step => [step, config.llm.models[STEP_TIERS[step]].name])) as Record<StepName, string>
}

/** Why research is off: no key, or step models without a price. */
export type ResearchSwitchOff = { cause: 'no-key' } | { cause: 'unpriced'; models: string[] }

/** Why no run can start now, whatever the story; null while research is on. `switchRefusal` words it for editors. */
export function researchSwitchOff(): ResearchSwitchOff | null {
  if (!config.research.tavilyApiKey) return { cause: 'no-key' }
  const unpriced = [...new Set(Object.values(stepModels()))].filter(m => !hasPrice(m))
  return unpriced.length > 0 ? { cause: 'unpriced', models: unpriced } : null
}

/** `researchSwitchOff` in the words editors see on a refused run, or null while research is on. */
export function switchRefusal(): string | null {
  const off = researchSwitchOff()
  if (!off) return null
  if (off.cause === 'no-key') return 'Research is switched off: TAVILY_API_KEY is not set'
  return `Research is refused: ${off.models.join(', ')} has no price in config.research.modelPrices, so its cost could not be counted`
}
