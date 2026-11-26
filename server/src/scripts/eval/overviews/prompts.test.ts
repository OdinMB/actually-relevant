import { describe, it, expect } from 'vitest'
import { AS_OF_RULE, CREDIT_RULE } from '../../../prompts/factRules.js'
import { buildEndEventJudgePrompt, buildFieldsJudgePrompt, fieldsJudgeSchema, type FieldsJudgeFact } from './prompts.js'

describe('buildFieldsJudgePrompt', () => {
  const fact: FieldsJudgeFact = {
    evidence: 'Floods have displaced 30,000 people since the dam failed on June 3, the agency said.',
    statement: 'Floods have displaced 30,000 people since the dam failed on June 3.',
    outlet: 'Example News',
    date: '2026-06-10',
    value: 30000,
    valueHigh: null,
    unit: 'people',
    approx: 'exact',
    counted: 'people displaced by the floods',
    place: '',
    asOf: null,
    credited: 'the agency',
  }
  const prompt = buildFieldsJudgePrompt([fact])
  const requirements = prompt.slice(prompt.indexOf('<REQUIREMENTS>'), prompt.indexOf('</REQUIREMENTS>'))

  it("judges the as-of and the credit by production's rules of 2026-11-25, so a rightly empty as-of is right", () => {
    expect(requirements).toContain(AS_OF_RULE)
    expect(requirements).toContain(CREDIT_RULE)
    expect(requirements).toContain('An empty AS_OF is right where this rule leaves the field empty')
    expect(requirements).not.toContain('AS_OF is the date the fact describes')
  })

  it('describes the two fields in the schema as the rules define them', () => {
    const fields = fieldsJudgeSchema.shape.facts.element.shape
    expect(fields.asOf.description).toContain('empty where the as-of rule in <REQUIREMENTS> leaves it empty')
    expect(fields.asOf.description).not.toContain('the date the fact describes')
    expect(fields.credited.description).toContain('who the source says the information comes from')
    expect(fields.credited.description).toContain('False when it names who acts in the fact')
  })

  it('shows an empty field as empty', () => {
    expect(prompt).toContain('<AS_OF>(empty)</AS_OF>')
    expect(prompt).toContain('<CREDITED>the agency</CREDITED>')
  })
})

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
