import { describe, it, expect } from 'vitest'
import { parseJobLeaseTiming, parseSameSite } from './config.js'

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
