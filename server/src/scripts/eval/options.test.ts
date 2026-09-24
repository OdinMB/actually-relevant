import { describe, it, expect } from 'vitest'
import { parseOptions, DEFAULT_BUDGET_USD, DEFAULT_FLOOR, SUITE_NAMES } from './options.js'

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
