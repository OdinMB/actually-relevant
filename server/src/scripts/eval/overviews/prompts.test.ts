import { describe, it, expect } from 'vitest'
import { buildEndEventJudgePrompt } from './prompts.js'

describe('buildEndEventJudgePrompt', () => {
  const prompt = buildEndEventJudgePrompt({
    development: 'El Niño 2026',
    key: 'Any one of the forecasting agencies (NOAA, WMO, JMA or the Australian Bureau of Meteorology) declares the El Niño over',
    founded: 'The WMO declares this El Niño episode over',
  })
  const requirements = prompt.slice(prompt.indexOf('<REQUIREMENTS>'), prompt.indexOf('</REQUIREMENTS>'))

  it('treats a declaration by one of the alternative bodies a key lists as the same event (ADR-0072: end events only mark a turning point)', () => {
    expect(requirements).toMatch(
      /When <KEY> lists several bodies as alternatives, any one of which may make the declaration, an end event naming the declaration of one of those bodies is the same event\./,
    )
  })

  it('still refuses a narrower or wider event', () => {
    expect(requirements).toContain('A narrower or wider event is not the same')
  })

  it('gives the key and the founded end event as escaped input after the requirements', () => {
    expect(prompt.indexOf('<KEY>Any one')).toBeGreaterThan(prompt.indexOf('</REQUIREMENTS>'))
    expect(prompt).toContain('<FOUNDED>The WMO declares this El Niño episode over</FOUNDED>')
    const escaped = buildEndEventJudgePrompt({ development: 'd', key: 'A & B <declare>', founded: 'f' })
    expect(escaped).toContain('<KEY>A &amp; B &lt;declare&gt;</KEY>')
  })
})
