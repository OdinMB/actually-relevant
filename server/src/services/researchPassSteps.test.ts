import { describe, expect, it } from 'vitest'
import { CARD_STEP_OF, PASS_STEPS } from './researchPassSteps.js'
import { CONTEXT_STEPS } from './storyContextPipeline.js'

describe('CARD_STEP_OF', () => {
  // The map is built with a cast, so the compiler does not hold it to every context step
  it('names every context step as a pass step, so a pass can make each of their calls', () => {
    for (const step of CONTEXT_STEPS) expect(PASS_STEPS, step).toContain(CARD_STEP_OF[step])
  })
})
