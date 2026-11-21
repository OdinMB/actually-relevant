import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_HALVES, developmentHalf, inDevelopmentHalf, keysOfHalf } from './developmentHalves.js'
import { KEYS_DIR, keyFileNames, readKeyFiles } from './keyFiles.js'

describe('the development halves', () => {
  it('put every committed key in exactly one half, and name no key that is not committed', () => {
    const ids = keyFileNames(KEYS_DIR).map(name => name.replace(/\.json$/, ''))
    const listed = [...DEVELOPMENT_HALVES.judge, ...DEVELOPMENT_HALVES.tune]
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual([...ids].sort())
  })

  it('keep Ebola in the judged half', () => {
    expect(developmentHalf('ebola-drc-2026')).toBe('judge')
  })

  it('take a listed key in its half and in all, and an unlisted one in none', () => {
    const [judged] = DEVELOPMENT_HALVES.judge
    expect(inDevelopmentHalf(judged!, 'judge')).toBe(true)
    expect(inDevelopmentHalf(judged!, 'tune')).toBe(false)
    expect(inDevelopmentHalf(judged!, 'all')).toBe(true)
    expect(inDevelopmentHalf('not-a-key', 'all')).toBe(false)
  })

  it("splits the well-formed keys into the half's and the others, leaving out a file with errors", () => {
    const files = readKeyFiles()
    const { keys, others } = keysOfHalf(files, 'judge')
    expect(keys.map(k => k.id).sort()).toEqual([...DEVELOPMENT_HALVES.judge].sort())
    expect(others.map(k => k.id).sort()).toEqual([...DEVELOPMENT_HALVES.tune].sort())
    const broken = files.map(f => (f.key?.id === DEVELOPMENT_HALVES.tune[0] ? { ...f, errors: ['x'] } : f))
    expect(keysOfHalf(broken, 'judge').others).toHaveLength(DEVELOPMENT_HALVES.tune.length - 1)
    expect(keysOfHalf(files, 'all').others).toEqual([])
  })
})
