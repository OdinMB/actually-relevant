import { describe, it, expect } from 'vitest'
import { buildDerivePrompt, buildRepairPrompt, buildWritePrompt, LATEST_STATE, type PoolSourceBrief, type RepairInput, type WriteInput } from './research.js'

const source = (id: string, date: string | null): PoolSourceBrief => ({
  id,
  outlet: 'Dawn',
  kind: 'news-report',
  country: 'Pakistan',
  date,
  relation: 'same-development',
  facts: [{ id: `${id}F1`, statement: 'The import ban was announced.', supportingSentence: 'The import ban was announced.', measures: '' }],
  voices: [],
})

const sources = [source('S0', '2026-11-10T06:00:00.000Z'), source('S1', 'Thu, 12 Nov 2026 08:00:00 GMT'), source('S2', null)]

const write: WriteInput = {
  article: {
    title: 'Pakistan bans imports',
    content: 'The import ban was announced.',
    publisher: 'Dawn',
    url: 'https://dawn.com/ban',
    guidelines: { factors: 'f', antifactors: 'a', ratings: 'r' },
    emotionTag: null,
  },
  articleDate: '2026-11-10',
  oldBefore: '2026-10-27',
  sources,
  earlier: [],
}

const repair: RepairInput = {
  sources,
  earlier: [],
  story: [{ label: 'Title', text: 'Pakistan bans imports' }],
  repairs: [{ label: 'Title', text: 'Pakistan bans imports', factIds: null, problems: ['fails the fact check: no fact states it'] }],
}

/** The text of one XML block of a prompt: its tags on lines of their own, not a mention such as the GOAL's. */
const block = (prompt: string, name: string) => new RegExp(`\\n<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(prompt)?.[1] ?? ''

/** The date each SOURCE of a prompt's <FACTS> carries, in order. */
const sourceDates = (prompt: string) => [...prompt.matchAll(/<SOURCE id="S\d+"[^>]* date="([^"]*)"/g)].map(m => m[1])

describe('the newest information leads', () => {
  it("shows the write and repair prompts each source's publication day, as search and feeds give it, so the writer can tell which report is newest", () => {
    expect(sourceDates(buildWritePrompt(write))).toEqual(['2026-11-10', '2026-11-12', 'unknown'])
    expect(sourceDates(buildRepairPrompt(repair))).toEqual(['2026-11-10', '2026-11-12', 'unknown'])
  })

  it('gives the write and repair prompts the same rule, and the derive prompt its headline part', () => {
    expect(buildWritePrompt(write)).toContain(LATEST_STATE)
    expect(buildRepairPrompt(repair)).toContain(LATEST_STATE)
    expect(LATEST_STATE).toMatch(/latest state/)
    expect(buildDerivePrompt({ titleLabel: 'Trade', paragraphs: ['The plan was dropped.'] })).toMatch(/latest state/)
  })
})

describe('contradicted narrows', () => {
  it('counts only sources that disagree at the same time with no later report settling it, and sends a later reversal to the latest state', () => {
    const rule = block(buildWritePrompt(write), 'CONTRADICTED')
    expect(rule).toMatch(/at the same time/)
    expect(rule).toMatch(/no later report settles/)
    expect(rule).toContain('<LATEST_STATE>')
  })
})
