import { describe, it, expect } from 'vitest'
import { parseSameSite } from './config.js'

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
