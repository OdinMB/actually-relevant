/**
 * The fact check's and the figure check's samples (`eval:overviews`, steps `fact-check` and
 * `figure-check`): what one is, and for each `--facts` value (`OVERVIEW_FACT_SOURCES`) how it is
 * built from what the run's earlier steps left: research's statements loaded from the database, run
 * 1's kept facts of the `context` step or of the `pass-pool` step's first passes (both through
 * `contextFactFixtures`), or the lines the `stands` step's run 1 kept; and, for the two sources of
 * rendered facts, the stories whose figures the figure check samples (`figureInput`). Kept apart
 * from the flags module, which names the step each source needs, so that parsing the flags never
 * loads the step modules. Pure.
 */
import { isRenderedSource, type OverviewFactSource, type OverviewHalf, type RenderedFactSource } from '../options.js'
import type { ContextStepRun } from './context.js'
import { contextFactFixtures, type ContextFacts, type StoryFacts } from './contextFacts.js'
import type { FactFixture, FactFixtures } from './factFixtures.js'
import type { FigureCheckInput } from './figureCheck.js'
import { standsFactFixtures, type StandsStepReport } from './stands.js'

/**
 * The facts the fact check plants errors in: research's sample from the database, or run 1 of the
 * `context` step, of the `pass-pool` step's first passes (`pool`), or of the `stands` step.
 */
export type FactSample =
  | { source: 'research'; fixtures: FactFixtures }
  | { source: 'context'; facts: ContextFacts; half: OverviewHalf }
  | { source: 'pool'; facts: ContextFacts; half: OverviewHalf }
  | { source: 'stands'; facts: ContextFacts; half: OverviewHalf }

/** What a run left for the fact check to sample: research's facts from the database, and each step's run; null for one that did not run (or was not asked for). */
export interface SampledRuns {
  research: FactFixtures | null
  context: ContextStepRun | null
  stands: StandsStepReport | null
  pool: StoryFacts[] | null
}

/** Run 1 of the `context` step, story by story: each story's facts as context reads them and the figures production's figure check removed. */
const contextStories = (run: ContextStepRun): StoryFacts[] =>
  run.runs.filter(r => r.run === 1).map(r => ({ slug: r.slug, title: r.input.title, facts: r.result.facts, removed: r.result.record.removedFigures }))

/** Each source's sample, at most `size` facts; null when what it samples from is missing. */
export const FACT_SAMPLERS: Record<OverviewFactSource, (runs: SampledRuns, size: number, half: OverviewHalf) => FactSample | null> = {
  research: runs => runs.research && { source: 'research', fixtures: runs.research },
  context: (runs, size, half) => runs.context && { source: 'context', facts: contextFactFixtures(contextStories(runs.context), size), half },
  stands: (runs, size, half) => runs.stands && { source: 'stands', facts: standsFactFixtures(runs.stands.kept, size), half },
  pool: (runs, size, half) => runs.pool && { source: 'pool', facts: contextFactFixtures(runs.pool, size), half },
}

/** Each source of rendered facts' stories, run 1's, for the figure check; null when its step did not run. */
const FIGURE_SOURCES: Record<RenderedFactSource, (runs: SampledRuns) => StoryFacts[] | null> = {
  context: runs => runs.context && contextStories(runs.context),
  pool: runs => runs.pool,
}

/** What the figure check samples for `--facts <source>`: its stories, run 1's; null for a source of no rendered facts, or one whose step did not run. */
export function figureInput(source: OverviewFactSource, runs: SampledRuns, half: OverviewHalf): FigureCheckInput | null {
  if (!isRenderedSource(source)) return null
  const stories = FIGURE_SOURCES[source](runs)
  return stories && { source, half, stories }
}

/** A sample's facts, in sample order. */
export const sampledFacts = (s: FactSample): FactFixture[] => (s.source === 'research' ? s.fixtures.facts : s.facts.facts)
