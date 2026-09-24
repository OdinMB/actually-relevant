import { describe, it, expect } from 'vitest'
import { parseOptions, parseRecalibrationOptions, DEFAULT_BUDGET_USD, DEFAULT_FLOOR, SUITE_NAMES } from './options.js'

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
    expect(() => parseOptions(['--out', 'x', '--budget', '20.01'])).toThrow(/budget/)
    expect(parseOptions(['--out', 'x', '--budget', '20']).budget).toBe(20)
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
      half: 'all', steps: ['preassess', 'assess', 'dedup'], effort: 'medium', dedupEffort: 'low', dryRun: false, budget: DEFAULT_BUDGET_USD,
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

  it('refuses a partial (--limit) rating set, which would replace the owner\'s set with a stub', () => {
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

  it('applies the same spend cap and floor format as eval:models', () => {
    expect(() => parseRecalibrationOptions(['--out', 'x', '--budget', '21'])).toThrow(/budget/)
    expect(() => parseRecalibrationOptions(['--out', 'x', '--floor', '2026-2-1'])).toThrow(/--floor/)
    expect(parseRecalibrationOptions(['--out', 'x', '--floor', '2026-02-01']).floor).toBe('2026-02-01')
  })
})
