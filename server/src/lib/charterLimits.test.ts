import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { config } from '../config.js'
import { loadCharterLimits } from './charterLimits.js'

describe('loadCharterLimits', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('reads shared/overviewCharterLimits.json into config.overviews, the limits the admin forms read too', () => {
    const limits = loadCharterLimits()
    expect(config.overviews).toMatchObject({
      maxTitleChars: limits.titleChars,
      maxInChars: limits.inChars,
      maxOutEntries: limits.outEntries,
      maxOutChars: limits.outChars,
      maxEndEventChars: limits.endEventChars,
    })
  })

  it('refuses a file missing a limit or holding one not a positive whole number, so a bad file stops the server at boot', () => {
    dir = mkdtempSync(join(tmpdir(), 'charter-limits-'))
    const file = join(dir, 'limits.json')
    writeFileSync(file, JSON.stringify({ titleChars: 200, inChars: 1000, outEntries: 12, outChars: 120 }))
    expect(() => loadCharterLimits(file)).toThrow()
    writeFileSync(file, JSON.stringify({ titleChars: 200, inChars: 0, outEntries: 12, outChars: 120, endEventChars: 400 }))
    expect(() => loadCharterLimits(file)).toThrow()
  })
})
