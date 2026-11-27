import { describe, it, expect } from 'vitest'
import { DEFAULT_WINDOW_MONTHS, copyWindow, describeWindow, parseWindowArgs, windowStart } from './window.js'

describe("the copy's window", () => {
  it('starts the given number of calendar months before now, at the same time of day', () => {
    expect(windowStart(new Date('2026-11-26T12:34:56.789Z'), 6)).toEqual(new Date('2026-05-26T12:34:56.789Z'))
    expect(windowStart(new Date('2026-03-15T00:00:00.000Z'), 6)).toEqual(new Date('2025-09-15T00:00:00.000Z'))
    expect(windowStart(new Date('2026-11-26T12:00:00.000Z'), 24)).toEqual(new Date('2024-11-26T12:00:00.000Z'))
  })

  it('starts on the last day of a shorter month rather than running into the next', () => {
    expect(windowStart(new Date('2026-08-31T10:00:00.000Z'), 6)).toEqual(new Date('2026-02-28T10:00:00.000Z'))
    expect(windowStart(new Date('2028-08-31T10:00:00.000Z'), 6)).toEqual(new Date('2028-02-29T10:00:00.000Z'))
    expect(windowStart(new Date('2026-12-31T23:59:59.999Z'), 1)).toEqual(new Date('2026-11-30T23:59:59.999Z'))
  })

  it('records the months and their cutoff, or every story', () => {
    const now = new Date('2026-11-26T12:00:00.000Z')
    expect(copyWindow(6, now)).toEqual({ months: 6, since: '2026-05-26T12:00:00.000Z' })
    expect(copyWindow('all', now)).toBe('all')
    expect(describeWindow({ months: 6, since: '2026-05-26T12:00:00.000Z' })).toContain('2026-05-26T12:00:00.000Z')
    expect(describeWindow('all')).not.toEqual(describeWindow({ months: 6, since: '2026-05-26T12:00:00.000Z' }))
  })
})

describe('the window flags', () => {
  it('reads --months <n> and --all, and defaults to the window the owner chose', () => {
    expect(parseWindowArgs(['--out', 'x.jsonl.gz'])).toBe(DEFAULT_WINDOW_MONTHS)
    expect(parseWindowArgs(['--out', 'x.jsonl.gz', '--months', '12'])).toBe(12)
    expect(parseWindowArgs(['--all', '--out', 'x.jsonl.gz'])).toBe('all')
  })

  it.each([
    ['both flags', ['--all', '--months', '3'], /either/],
    ['no number', ['--months'], /--months/],
    ['a flag for a number', ['--months', '--all'], /--months/],
    ['zero', ['--months', '0'], /--months/],
    ['a negative number', ['--months', '-2'], /--months/],
    ['a fraction', ['--months', '1.5'], /--months/],
    ['a word', ['--months', 'six'], /--months/],
  ])('refuses %s', (_label, argv, message) => {
    expect(() => parseWindowArgs(argv)).toThrow(message)
  })
})
