import { describe, it, expect } from 'vitest'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import { contextFact, contextInput, contextResult, gapKey } from '../../../test/contextFixtures.js'
import type { ContextStepRun } from './context.js'
import type { JudgedRun } from './contextJudge.js'
import { contextFactFixtures } from './contextFacts.js'
import { resultDates, scoreContext, scoreFields } from './contextScore.js'
import { FACT_FIXTURES_VERSION, type FactFixture, type FactFixtures } from './factFixtures.js'
import { FACT_SAMPLERS, figureInput, sampledFacts, type SampledRuns } from './factSources.js'

const NOTHING: SampledRuns = { research: null, context: null, stands: null, pool: null }

const judgedRun = (slug: string, run: number, facts: ContextFactData[]): JudgedRun => ({
  slug,
  run,
  key: gapKey({ slug }),
  input: contextInput(),
  result: contextResult({ facts }),
})

const contextRun = (runs: JudgedRun[]): ContextStepRun => ({
  report: {
    half: 'judge',
    repeat: 2,
    keys: 2,
    left: [],
    stories: 2,
    deskUsd: null,
    skipped: [],
    judge: null,
    score: scoreContext([]),
    fields: scoreFields([]),
    dates: resultDates([]),
  },
  runs,
})

const keys = (facts: FactFixture[]) => facts.map(f => f.key)

describe('FACT_SAMPLERS', () => {
  it("samples only run 1 of the context step's runs", () => {
    const runs = contextRun([judgedRun('a', 1, [contextFact('S1F1')]), judgedRun('a', 2, [contextFact('S2F1')]), judgedRun('b', 1, [contextFact('S3F1')])])
    const sample = FACT_SAMPLERS.context({ ...NOTHING, context: runs }, 10, 'judge')
    expect(sample).toMatchObject({ source: 'context', half: 'judge' })
    expect(keys(sampledFacts(sample!))).toEqual(['a:S1F1', 'b:S3F1'])
  })

  it("samples the pass-pool step's stories as given", () => {
    const sample = FACT_SAMPLERS.pool(
      { ...NOTHING, pool: [{ slug: 'p', title: 'P', facts: [contextFact('S1F1'), contextFact('S1F2')], removed: [] }] },
      1,
      'tune',
    )
    expect(sample).toMatchObject({ source: 'pool', half: 'tune' })
    expect(keys(sampledFacts(sample!))).toEqual(['p:S1F1'])
  })

  it('gives no sample for a source whose step did not run', () => {
    for (const sample of Object.values(FACT_SAMPLERS)) expect(sample(NOTHING, 10, 'all')).toBeNull()
  })
})

describe('figureInput', () => {
  const removed = { ref: 'S3F2', figure: '1 series', counted: 'series of actions', answer: 'not-stated' as const }

  it("gives the figure check run 1's stories of the context step, each with the figures production removed", () => {
    const first = { ...judgedRun('a', 1, [contextFact('S1F1')]), result: contextResult({ facts: [contextFact('S1F1')] }, { removedFigures: [removed] }) }
    const runs = contextRun([first, judgedRun('a', 2, [contextFact('S2F1')]), judgedRun('b', 1, [contextFact('S3F1')])])
    const input = figureInput('context', { ...NOTHING, context: runs }, 'judge')
    expect(input).toMatchObject({ source: 'context', half: 'judge' })
    expect(input?.stories.map(s => [s.slug, s.facts.map(f => f.ref), s.removed])).toEqual([
      ['a', ['S1F1'], [removed]],
      ['b', ['S3F1'], []],
    ])
  })

  it("gives the pass-pool step's stories as given", () => {
    const pool = [{ slug: 'p', title: 'P', facts: [contextFact('S1F1')], removed: [removed] }]
    expect(figureInput('pool', { ...NOTHING, pool }, 'tune')).toEqual({ source: 'pool', half: 'tune', stories: pool })
  })

  it('gives none for a source whose step did not run, or one with no rendered facts', () => {
    expect(figureInput('context', NOTHING, 'all')).toBeNull()
    expect(figureInput('pool', NOTHING, 'all')).toBeNull()
    const ran = { ...NOTHING, context: contextRun([judgedRun('a', 1, [contextFact('S1F1')])]) }
    expect(figureInput('research', ran, 'all')).toBeNull()
    expect(figureInput('stands', ran, 'all')).toBeNull()
  })
})

describe('sampledFacts', () => {
  it("reads research's fixtures and a step's sample alike", () => {
    const facts = contextFactFixtures([{ slug: 'p', title: 'P', facts: [contextFact('S1F1'), contextFact('S2F1')] }], 10)
    const fixtures: FactFixtures = {
      version: FACT_FIXTURES_VERSION,
      createdAt: '2026-11-24T08:00:00.000Z',
      anchor: null,
      size: 300,
      dbClass: 'local',
      readOnlyMode: 'session',
      facts: facts.facts.slice(1),
      runsRead: 1,
      olderShape: 0,
      shortfalls: [],
    }
    expect(keys(sampledFacts({ source: 'context', facts, half: 'all' }))).toEqual(['p:S1F1', 'p:S2F1'])
    expect(keys(sampledFacts({ source: 'research', fixtures }))).toEqual(['p:S2F1'])
  })
})
