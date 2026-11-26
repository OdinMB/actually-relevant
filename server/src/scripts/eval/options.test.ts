import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  parseCapCommand,
  parseOptions,
  parseOverviewOptions,
  parseRecalibrationOptions,
  parseResearchOptions,
  DEFAULT_BUDGET_USD,
  DEFAULT_FLOOR,
  MAX_ASSESS_SIZE,
  MAX_BUDGET_USD,
  OVERVIEW_DEFAULT_ARMS,
  OVERVIEW_DEFAULT_CONCURRENCY,
  OVERVIEW_DEFAULT_STEPS,
  OVERVIEW_MAX_SIZE,
  OVERVIEW_STEPS,
  RESEARCH_DEFAULT_BUDGET_USD,
  RESEARCH_DEFAULT_SIZE,
  RESEARCH_MAX_SIZE,
  SUITE_NAMES,
} from './options.js'
import { config } from '../../config.js'
import { STEP_TIERS } from '../../services/researchPipeline.js'
import { MAX_REPEAT } from './repeats.js'
import { STEP_ARMS } from './research/pipeline.js'

/** A cent over the project's spend cap, which every eval CLI refuses as a --budget. */
const ABOVE_CAP = String(MAX_BUDGET_USD + 0.01)

describe('parseOptions', () => {
  it('requires --out', () => {
    expect(() => parseOptions([])).toThrow(/--out/)
  })

  it('defaults to every suite and the default budget', () => {
    const o = parseOptions(['--out', 'x'])
    expect(o.suites).toEqual(SUITE_NAMES)
    expect(o.budget).toBe(DEFAULT_BUDGET_USD)
    expect(o.dryRun).toBe(false)
  })

  it('refuses a budget above the spend cap', () => {
    expect(() => parseOptions(['--out', 'x', '--budget', ABOVE_CAP])).toThrow(/budget/)
    expect(parseOptions(['--out', 'x', '--budget', String(MAX_BUDGET_USD)]).budget).toBe(MAX_BUDGET_USD)
  })

  it('rejects unknown suites and non-positive limits', () => {
    expect(() => parseOptions(['--out', 'x', '--suites', 'related,bogus'])).toThrow(/bogus/)
    expect(() => parseOptions(['--out', 'x', '--limit', '0'])).toThrow(/--limit/)
  })

  it('defaults the crawl floor and accepts an earlier one', () => {
    expect(parseOptions(['--out', 'x']).floor).toBe(DEFAULT_FLOOR)
    expect(parseOptions(['--out', 'x', '--floor', '2026-02-01']).floor).toBe('2026-02-01')
  })

  it('rejects a malformed crawl floor', () => {
    expect(() => parseOptions(['--out', 'x', '--floor', '2026-2-1'])).toThrow(/--floor/)
    expect(() => parseOptions(['--out', 'x', '--floor', '2026-13-40'])).toThrow(/--floor/)
  })

  it("defaults to phase 1's 50 full-assessment stories and no exclusions", () => {
    expect(parseOptions(['--out', 'x'])).toMatchObject({ assessSize: 50, exclude: [] })
  })

  it('takes a larger full-assessment sample within the cap', () => {
    expect(parseOptions(['--out', 'x', '--assess-size', '150']).assessSize).toBe(150)
    expect(() => parseOptions(['--out', 'x', '--assess-size', '0'])).toThrow(/--assess-size/)
    expect(() => parseOptions(['--out', 'x', '--assess-size', String(MAX_ASSESS_SIZE + 1)])).toThrow(/--assess-size/)
  })

  it('takes a comma list of folders whose stories leave the rating pools', () => {
    expect(parseOptions(['--out', 'x', '--exclude', '../DOCS/a, ../DOCS/b']).exclude).toEqual(['../DOCS/a', '../DOCS/b'])
  })

  it('parses a smoke-run command line', () => {
    const o = parseOptions(['--out', 'x', '--suites', 'related', '--limit', '2'])
    expect(o).toMatchObject({ suites: ['related'], limit: 2 })
  })
})

describe('parseRecalibrationOptions', () => {
  it('requires --out', () => {
    expect(() => parseRecalibrationOptions([])).toThrow(/--out/)
  })

  it('defaults to the three checks on the whole sample, medium for ratings and low for dedup', () => {
    expect(parseRecalibrationOptions(['--out', 'x'])).toMatchObject({
      half: 'all',
      steps: ['preassess', 'assess', 'dedup'],
      effort: 'medium',
      dedupEffort: 'low',
      dryRun: false,
      budget: DEFAULT_BUDGET_USD,
    })
  })

  it('never regenerates the rating set unless asked', () => {
    expect(parseRecalibrationOptions(['--out', 'x']).steps).not.toContain('rating-set')
    expect(parseRecalibrationOptions(['--out', 'x', '--steps', 'rating-set']).steps).toEqual(['rating-set'])
  })

  it('runs the phase-2 ship checks only when named', () => {
    expect(parseRecalibrationOptions(['--out', 'x']).steps).toEqual(['preassess', 'assess', 'dedup'])
    expect(parseRecalibrationOptions(['--out', 'x', '--steps', 'selection,assess,social-post']).steps).toEqual(['assess', 'social-post', 'selection'])
  })

  it("refuses a partial (--limit) rating set, which would replace the owner's set with a stub", () => {
    expect(() => parseRecalibrationOptions(['--out', 'x', '--steps', 'assess,rating-set', '--limit', '1'])).toThrow(/rating-set/)
    expect(parseRecalibrationOptions(['--out', 'x', '--steps', 'assess', '--limit', '1']).limit).toBe(1)
  })

  it('accepts only the calibration or holdout half, or all', () => {
    expect(parseRecalibrationOptions(['--out', 'x', '--half', 'holdout']).half).toBe('holdout')
    expect(() => parseRecalibrationOptions(['--out', 'x', '--half', 'test'])).toThrow(/--half/)
  })

  it('rejects unknown steps and efforts', () => {
    expect(() => parseRecalibrationOptions(['--out', 'x', '--steps', 'assess,related'])).toThrow(/related/)
    expect(() => parseRecalibrationOptions(['--out', 'x', '--effort', 'max-ish'])).toThrow(/--effort/)
    expect(parseRecalibrationOptions(['--out', 'x', '--effort', 'high', '--dedup-effort', 'medium'])).toMatchObject({ effort: 'high', dedupEffort: 'medium' })
  })

  it('runs each rating prompt once unless asked to repeat, up to the cap', () => {
    expect(parseRecalibrationOptions(['--out', 'x']).repeat).toBe(1)
    expect(parseRecalibrationOptions(['--out', 'x', '--repeat', '3']).repeat).toBe(3)
    expect(() => parseRecalibrationOptions(['--out', 'x', '--repeat', '0'])).toThrow(/--repeat/)
    expect(() => parseRecalibrationOptions(['--out', 'x', '--repeat', String(MAX_REPEAT + 1)])).toThrow(/--repeat/)
  })

  it('applies the same spend cap and floor format as eval:models', () => {
    expect(() => parseRecalibrationOptions(['--out', 'x', '--budget', ABOVE_CAP])).toThrow(/budget/)
    expect(() => parseRecalibrationOptions(['--out', 'x', '--floor', '2026-2-1'])).toThrow(/--floor/)
    expect(parseRecalibrationOptions(['--out', 'x', '--floor', '2026-02-01']).floor).toBe('2026-02-01')
  })
})

describe('parseResearchOptions', () => {
  it('requires --out', () => {
    expect(() => parseResearchOptions([])).toThrow(/--out/)
  })

  it("defaults to the 30 newest stories, a live run and this CLI's own budget", () => {
    expect(parseResearchOptions(['--out', 'x'])).toEqual({
      out: 'x',
      size: RESEARCH_DEFAULT_SIZE,
      dryRun: false,
      budget: RESEARCH_DEFAULT_BUDGET_USD,
      concurrency: 4,
      refreshFixtures: false,
    })
    expect(RESEARCH_DEFAULT_BUDGET_USD).toBeLessThan(DEFAULT_BUDGET_USD)
  })

  it('takes a sample size from 1 up to the cap', () => {
    expect(parseResearchOptions(['--out', 'x', '--size', String(RESEARCH_MAX_SIZE)]).size).toBe(RESEARCH_MAX_SIZE)
    expect(() => parseResearchOptions(['--out', 'x', '--size', String(RESEARCH_MAX_SIZE + 1)])).toThrow(/--size/)
    expect(() => parseResearchOptions(['--out', 'x', '--size', '0'])).toThrow(/--size/)
  })

  it('applies the project spend cap to --budget', () => {
    expect(parseResearchOptions(['--out', 'x', '--budget', String(MAX_BUDGET_USD)]).budget).toBe(MAX_BUDGET_USD)
    expect(() => parseResearchOptions(['--out', 'x', '--budget', ABOVE_CAP])).toThrow(/budget/)
    expect(() => parseResearchOptions(['--out', 'x', '--budget', '0'])).toThrow(/budget/)
  })

  it('parses a smoke-run command line', () => {
    expect(parseResearchOptions(['--out', 'x', '--limit', '2', '--dry-run', '--refresh-fixtures', '--concurrency', '2'])).toMatchObject({
      limit: 2,
      dryRun: true,
      refreshFixtures: true,
      concurrency: 2,
    })
    expect(() => parseResearchOptions(['--out', 'x', '--limit', '0'])).toThrow(/--limit/)
  })
})

describe('parseOverviewOptions', () => {
  it('requires --out', () => {
    expect(() => parseOverviewOptions([])).toThrow(/--out/)
  })

  it("defaults to the keys, research's fact check and the baseline: one run of 300 research facts on the research fact-check arm, every gap key, and the $3 budget", () => {
    expect(parseOverviewOptions(['--out', 'x'])).toEqual({
      out: 'x',
      steps: ['keys', 'fact-check', 'baseline'],
      budget: 3,
      dryRun: false,
      cacheOnly: false,
      rescore: false,
      concurrency: OVERVIEW_DEFAULT_CONCURRENCY,
      repeat: 1,
      size: 300,
      arms: [...OVERVIEW_DEFAULT_ARMS],
      refreshFixtures: false,
      facts: 'research',
      half: 'all',
    })
    expect(OVERVIEW_DEFAULT_STEPS).toEqual(OVERVIEW_STEPS.filter(s => OVERVIEW_DEFAULT_STEPS.includes(s)))
  })

  it('takes --cache-only, a rerun that makes no call, and refuses it with --dry-run', () => {
    expect(parseOverviewOptions(['--out', 'x', '--cache-only']).cacheOnly).toBe(true)
    expect(() => parseOverviewOptions(['--out', 'x', '--cache-only', '--dry-run'])).toThrow(/--cache-only/)
  })

  it('takes --rescore for the linking steps alone, and refuses it with --dry-run or --cache-only', () => {
    const linking = ['--out', 'x', '--steps', 'link,found,role', '--half', 'judge']
    expect(parseOverviewOptions([...linking, '--rescore']).rescore).toBe(true)
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'found', '--rescore']).rescore).toBe(true)
    expect(() => parseOverviewOptions([...linking, '--rescore', '--dry-run'])).toThrow(/--rescore/)
    expect(() => parseOverviewOptions([...linking, '--rescore', '--cache-only'])).toThrow(/--rescore/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'link,replay', '--rescore'])).toThrow(/--rescore/)
    expect(() => parseOverviewOptions(['--out', 'x', '--rescore'])).toThrow(/--rescore/)
  })

  it('runs more calls at once than the other evals by default, since three repeats of the linking replay go side by side', () => {
    expect(parseOverviewOptions(['--out', 'x']).concurrency).toBeGreaterThan(parseOptions(['--out', 'x']).concurrency)
    expect(parseOverviewOptions(['--out', 'x', '--concurrency', '2']).concurrency).toBe(2)
  })

  it("runs story context's steps only when named, in the order the run takes them", () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'fact-check,context,gap-keys,gap-draft']).steps).toEqual([
      'gap-keys',
      'gap-draft',
      'context',
      'fact-check',
    ])
  })

  it('takes --facts context only with the context and fact-check steps, and a --half of the gap keys', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'context,fact-check', '--facts', 'context', '--half', 'judge'])).toMatchObject({
      facts: 'context',
      half: 'judge',
    })
    expect(parseOverviewOptions(['--out', 'x', '--half', 'tune']).half).toBe('tune')
    expect(() => parseOverviewOptions(['--out', 'x', '--facts', 'context'])).toThrow(/name both context and fact-check/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'context', '--facts', 'context'])).toThrow(/--facts context/)
    expect(() => parseOverviewOptions(['--out', 'x', '--facts', 'news'])).toThrow(/--facts must be one of research, context, stands, pool/)
    expect(() => parseOverviewOptions(['--out', 'x', '--half', 'holdout'])).toThrow(/--half must be one of tune, judge, all/)
  })

  it('runs the upkeep steps only when named, the pass pool before the stands and the replay, the stands before the fact check that samples them', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'fact-check,replay,recenter,review,stands,pass-pool']).steps).toEqual([
      'pass-pool',
      'stands',
      'review',
      'recenter',
      'replay',
      'fact-check',
    ])
    expect(OVERVIEW_DEFAULT_STEPS.some(s => ['pass-pool', 'stands', 'review', 'recenter', 'replay'].includes(s))).toBe(false)
  })

  it('runs key-draft only when named, and only on its own: it writes the answer keys the other steps read', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'key-draft', '--half', 'judge'])).toMatchObject({ steps: ['key-draft'], half: 'judge' })
    expect(OVERVIEW_DEFAULT_STEPS).not.toContain('key-draft')
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'keys,key-draft'])).toThrow(/--steps key-draft runs on its own/)
  })

  it('takes --facts stands only with the stands and fact-check steps', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'stands,fact-check', '--facts', 'stands']).facts).toBe('stands')
    expect(() => parseOverviewOptions(['--out', 'x', '--facts', 'stands'])).toThrow(/name both stands and fact-check/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'stands', '--facts', 'stands'])).toThrow(/--facts stands/)
  })

  it("takes --facts pool only with the pass-pool and fact-check steps: it samples the first passes' pools", () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'pass-pool,fact-check', '--facts', 'pool', '--half', 'judge']).facts).toBe('pool')
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'fact-check', '--facts', 'pool'])).toThrow(/name both pass-pool and fact-check/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'pass-pool', '--facts', 'pool'])).toThrow(/--facts pool/)
  })

  it('runs figure-check only when named, right after fact-check', () => {
    expect(OVERVIEW_DEFAULT_STEPS).not.toContain('figure-check')
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'figure-check,fact-check,pass-pool', '--facts', 'pool']).steps).toEqual([
      'pass-pool',
      'fact-check',
      'figure-check',
    ])
  })

  it("refuses figure-check unless --facts names a source of rendered facts, whose run 1's figures it samples", () => {
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'figure-check'])).toThrow(/figure-check samples the figures of run 1: name --facts pool/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'pass-pool,figure-check'])).toThrow(/--facts context \(with context\)/)
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'stands,figure-check', '--facts', 'stands'])).toThrow(/figure-check samples/)
  })

  it('takes a --facts source with its step and either checking step', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'pass-pool,figure-check', '--facts', 'pool']).steps).toEqual(['pass-pool', 'figure-check'])
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'context,figure-check', '--facts', 'context']).facts).toBe('context')
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'pass-pool,fact-check', '--facts', 'pool']).facts).toBe('pool')
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'figure-check', '--facts', 'pool'])).toThrow(
      /name both pass-pool and fact-check or figure-check/,
    )
  })

  it("defaults to production's research fact-check arm, production's small tier as configured by default", () => {
    expect(OVERVIEW_DEFAULT_ARMS).toEqual([STEP_ARMS['fact-check']])
    expect(STEP_TIERS['fact-check']).toBe('small')
    expect(OVERVIEW_DEFAULT_ARMS).toEqual([{ model: config.llm.models.small.name, effort: config.llm.models.small.reasoningEffort }])
  })

  it('takes steps in any order and rejects an unknown one', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'baseline,keys']).steps).toEqual(['keys', 'baseline'])
    expect(() => parseOverviewOptions(['--out', 'x', '--steps', 'keys,rehearse'])).toThrow(/rehearse/)
  })

  it('takes arms as model@effort from the price table', () => {
    expect(parseOverviewOptions(['--out', 'x', '--arms', 'gpt-6-luna@medium, gpt-6.1-sol@high,gpt-6-luna@medium']).arms).toEqual([
      { model: 'gpt-6-luna', effort: 'medium' },
      { model: 'gpt-6.1-sol', effort: 'high' },
    ])
    expect(() => parseOverviewOptions(['--out', 'x', '--arms', 'gpt-7@low'])).toThrow(/--arms.*gpt-7/)
    expect(() => parseOverviewOptions(['--out', 'x', '--arms', 'gpt-6-luna'])).toThrow(/--arms/)
    expect(() => parseOverviewOptions(['--out', 'x', '--arms', 'gpt-6-luna@loud'])).toThrow(/--arms/)
  })

  it('caps the sample size, the repeats and the budget', () => {
    expect(
      parseOverviewOptions(['--out', 'x', '--size', String(OVERVIEW_MAX_SIZE), '--repeat', String(MAX_REPEAT), '--budget', String(MAX_BUDGET_USD)]),
    ).toMatchObject({
      size: OVERVIEW_MAX_SIZE,
      repeat: MAX_REPEAT,
      budget: MAX_BUDGET_USD,
    })
    expect(() => parseOverviewOptions(['--out', 'x', '--size', String(OVERVIEW_MAX_SIZE + 1)])).toThrow(/--size/)
    expect(() => parseOverviewOptions(['--out', 'x', '--repeat', String(MAX_REPEAT + 1)])).toThrow(/--repeat/)
    expect(() => parseOverviewOptions(['--out', 'x', '--budget', ABOVE_CAP])).toThrow(/budget/)
  })

  it('parses a smoke run of the fact check', () => {
    expect(parseOverviewOptions(['--out', 'x', '--steps', 'fact-check', '--limit', '10', '--dry-run', '--refresh-fixtures'])).toMatchObject({
      steps: ['fact-check'],
      limit: 10,
      dryRun: true,
      refreshFixtures: true,
    })
    expect(() => parseOverviewOptions(['--out', 'x', '--limit', '0'])).toThrow(/--limit/)
  })
})

describe('--cap, the task spend cap', () => {
  const parsers = { parseOptions, parseRecalibrationOptions, parseResearchOptions, parseOverviewOptions }
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(Object.entries(parsers))('%s takes the cap by name, else from EVAL_SPEND_CAP, else runs with none', (_, parse) => {
    vi.stubEnv('EVAL_SPEND_CAP', '')
    expect(parse(['--out', 'x']).cap).toBeUndefined()
    expect(parse(['--out', 'x', '--cap', 'cloud-1']).cap).toBe('cloud-1')
    vi.stubEnv('EVAL_SPEND_CAP', 'from-env')
    expect(parse(['--out', 'x']).cap).toBe('from-env')
    expect(parse(['--out', 'x', '--cap', 'flag-wins']).cap).toBe('flag-wins')
    expect(() => parse(['--out', 'x', '--cap', '../elsewhere'])).toThrow(/name/)
  })
})

describe('parseCapCommand', () => {
  it('creates a cap of a positive amount, at most the project cap', () => {
    expect(parseCapCommand(['new', 'cloud-1', '--usd', '5'])).toEqual({ command: 'new', name: 'cloud-1', usd: 5 })
    expect(() => parseCapCommand(['new', 'cloud-1'])).toThrow(/--usd/)
    expect(() => parseCapCommand(['new', 'cloud-1', '--usd', '0'])).toThrow(/--usd/)
    expect(() => parseCapCommand(['new', 'cloud-1', '--usd', ABOVE_CAP])).toThrow(/--usd/)
  })

  it('shows a cap by name, and refuses anything else', () => {
    expect(parseCapCommand(['show', 'cloud-1'])).toEqual({ command: 'show', name: 'cloud-1' })
    expect(() => parseCapCommand(['show'])).toThrow(/name/)
    expect(() => parseCapCommand(['raise', 'cloud-1', '--usd', '9'])).toThrow(/new|show/)
    expect(() => parseCapCommand(['show', 'a/b'])).toThrow(/name/)
  })
})
