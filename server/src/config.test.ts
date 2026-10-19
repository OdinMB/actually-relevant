import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { parseFraction, parseJobLeaseTiming, parseOneOf, parseSameSite, parseTrustProxyHops, parseWholeNumber } from './config.js'

describe('parseWholeNumber', () => {
  it('falls back when unset or empty', () => {
    expect(parseWholeNumber(undefined, 42, 'X')).toBe(42)
    expect(parseWholeNumber('', 42, 'X')).toBe(42)
  })

  it('takes a plain whole number', () => {
    expect(parseWholeNumber('60000', 1, 'X')).toBe(60_000)
  })

  it.each(['60s', 'NaN', '1.5', '-3', ' 5', '1e3', 'abc'])('refuses %j at startup, naming the variable', (value) => {
    expect(() => parseWholeNumber(value, 1, 'AUTH_REFRESH_REUSE_GRACE_MS')).toThrow(/AUTH_REFRESH_REUSE_GRACE_MS/)
  })

  it('refuses a value below the minimum, which is 1 unless 0 is allowed', () => {
    expect(() => parseWholeNumber('0', 5, 'X')).toThrow('at least 1')
    expect(parseWholeNumber('0', 5, 'X', 0)).toBe(0)
  })
})

describe('parseFraction', () => {
  it('falls back when unset and takes a value between 0 and 1', () => {
    expect(parseFraction(undefined, 0.5, 'X')).toBe(0.5)
    expect(parseFraction('0.25', 0.5, 'X')).toBe(0.25)
    expect(parseFraction('1', 0.5, 'X')).toBe(1)
    expect(parseFraction('0', 0.5, 'X')).toBe(0)
  })

  it.each(['1.5', '-0.1', 'half', '0.5x'])('refuses %j', (value) => {
    expect(() => parseFraction(value, 0.5, 'SELECT_RATIO')).toThrow(/SELECT_RATIO/)
  })
})

describe('parseOneOf', () => {
  const visibilities = ['public', 'unlisted', 'private'] as const

  it('falls back when unset and takes an allowed value', () => {
    expect(parseOneOf(undefined, 'unlisted', visibilities, 'X')).toBe('unlisted')
    expect(parseOneOf('public', 'unlisted', visibilities, 'X')).toBe('public')
  })

  it('refuses any other value', () => {
    expect(() => parseOneOf('direct', 'unlisted', visibilities, 'MASTODON_VISIBILITY')).toThrow(/MASTODON_VISIBILITY/)
  })
})

describe('config numeric overrides', () => {
  // Every override config.ts parses with a throwing parser, found by reading the source, so a new
  // one is covered without editing this list.
  const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')
  const wholeNumberVars = [...source.matchAll(/parseWholeNumber\(\s*process\.env\.([A-Z0-9_]+)/g)].map(m => m[1])
  const fractionVars = [...source.matchAll(/parseFraction\(\s*process\.env\.([A-Z0-9_]+)/g)].map(m => m[1])

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('parses every numeric override with a throwing parser (no bare parseInt or parseFloat on process.env)', () => {
    expect(source).not.toMatch(/parse(Int|Float)\(\s*process\.env/)
    expect(wholeNumberVars.length).toBeGreaterThan(45)
  })

  it.each([...wholeNumberVars, ...fractionVars])('refuses to load with a typo in %s', async (name) => {
    vi.stubEnv(name, '12x')
    vi.resetModules()
    await expect(import('./config.js')).rejects.toThrow(name)
  })

  it('loads with every override unset', async () => {
    vi.resetModules()
    const { config } = await import('./config.js')
    expect(config.auth.refreshReuseGraceMs).toBe(60_000)
    expect(config.mastodon.visibility).toBe('unlisted')
  })
})

describe('parseJobLeaseTiming', () => {
  it('falls back to a 2-minute lease renewed every 30 seconds when unset or empty', () => {
    expect(parseJobLeaseTiming(undefined, undefined)).toEqual({ leaseSeconds: 120, leaseRenewMs: 30_000 })
    expect(parseJobLeaseTiming('', '')).toEqual({ leaseSeconds: 120, leaseRenewMs: 30_000 })
  })

  it('takes overrides in whole seconds', () => {
    expect(parseJobLeaseTiming('180', '45')).toEqual({ leaseSeconds: 180, leaseRenewMs: 45_000 })
  })

  it('refuses a value that is not a positive whole number of seconds', () => {
    for (const bad of ['0', '-5', '1.5', 'two', '120s']) {
      expect(() => parseJobLeaseTiming(bad, undefined)).toThrow('JOB_LEASE_SECONDS')
      expect(() => parseJobLeaseTiming(undefined, bad)).toThrow('JOB_LEASE_RENEW_SECONDS')
    }
  })

  it('refuses a renewal interval that leaves fewer than two renewals before the lease runs out', () => {
    expect(() => parseJobLeaseTiming('120', '61')).toThrow('JOB_LEASE_RENEW_SECONDS')
    expect(() => parseJobLeaseTiming('60', undefined)).not.toThrow()
    expect(() => parseJobLeaseTiming('50', undefined)).toThrow('JOB_LEASE_RENEW_SECONDS')
  })
})

describe('parseSameSite', () => {
  it('leaves the environment default in place when unset or empty', () => {
    expect(parseSameSite(undefined, 'X')).toBeUndefined()
    expect(parseSameSite('', 'X')).toBeUndefined()
  })

  it('accepts a SameSite value in any case', () => {
    expect(parseSameSite('Strict', 'X')).toBe('strict')
  })

  it('refuses an unknown value at startup', () => {
    expect(() => parseSameSite('stirct', 'AUTH_COOKIE_SAMESITE')).toThrow('AUTH_COOKIE_SAMESITE')
  })
})

describe('parseTrustProxyHops', () => {
  it.each([undefined, ''])('defaults to 1 for %j', (value) => {
    expect(parseTrustProxyHops(value)).toBe(1)
  })

  it.each([
    ['0', 0],
    ['2', 2],
    ['3', 3],
  ])('parses %j as %i', (value, expected) => {
    expect(parseTrustProxyHops(value)).toBe(expected)
  })

  it.each(['-1', '1.5', '2abc', 'true', 'loopback', ' 2'])('throws for %j, naming TRUST_PROXY', (value) => {
    expect(() => parseTrustProxyHops(value)).toThrow(/TRUST_PROXY/)
  })
})
