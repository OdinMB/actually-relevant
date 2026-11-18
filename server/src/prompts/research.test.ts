import { describe, it, expect } from 'vitest'
import type { PoolFact } from '../services/researchChecks.js'
import {
  buildDerivePrompt,
  buildFactCheckPrompt,
  buildRepairPrompt,
  buildWritePrompt,
  LATEST_STATE,
  type CheckedItem,
  type PoolSourceBrief,
  type RepairInput,
  type WriteInput,
} from './research.js'

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

describe('old news narrows', () => {
  it('is old only with no new development since the cutoff, and a fresh development about an old event leads the story', () => {
    const prompt = buildWritePrompt(write)
    const rule = block(prompt, 'OLD_NEWS')
    // The cutoff is the call's own value: the rule names it, the closing request gives it
    expect(rule).not.toContain(write.oldBefore)
    expect(rule).toContain('the old-news date <REQUEST> gives')
    expect(block(prompt, 'REQUEST')).toContain(`Old-news date: ${write.oldBefore}`)
    expect(rule).toMatch(/no fact reports a new development/)
    expect(rule).toMatch(/written around that development/)
    expect(prompt).toMatch(/Every field is about one development: [^\n]*<OLD_NEWS>/)
  })
})

describe('the fact check shows each fact once', () => {
  const f = (id: string, statement = `Fact ${id}.`): PoolFact => ({ id, statement, supportingSentence: `Sentence of ${id}.`, measures: '' })
  const pool = [f('S1F1'), f('S1F2'), f('S2F1')]
  const items: CheckedItem[] = [
    { label: 'Story paragraph 1', text: 'One.', facts: [f('S1F1'), f('S1F2')], numbersNotFound: [] },
    { label: 'Story paragraph 2', text: 'Two.', facts: [f('S2F1'), f('S1F1')], numbersNotFound: [] },
    { label: 'Title', text: 'Head', facts: 'pool', numbersNotFound: [] },
  ]
  const evidenceIds = (prompt: string) =>
    [...prompt.matchAll(/<ITEM number="\d+" label="([^"]+)">[\s\S]*?(?:<EVIDENCE>([^<]*)<\/EVIDENCE>|(<AGAINST_POOL\/>))?\n<\/ITEM>/g)].map(m => [
      m[1],
      m[3] ? 'pool' : (m[2] ?? ''),
    ])

  it('in one FACTS block, each item listing its evidence by id in the order it had', () => {
    const prompt = buildFactCheckPrompt(items, [], pool)
    for (const fact of pool) expect(prompt.split(`<FACT id="${fact.id}">`)).toHaveLength(2)
    expect(prompt).not.toContain('<CITED_FACTS>')
    expect(prompt).not.toContain('<POOL>')
    expect(evidenceIds(prompt)).toEqual([
      ['Story paragraph 1', 'S1F1, S1F2'],
      ['Story paragraph 2', 'S2F1, S1F1'],
      ['Title', 'pool'],
    ])
  })

  it('refuses two different facts under one id (`factsOfItems`)', () => {
    expect(() =>
      buildFactCheckPrompt([items[0]!, { label: 'Story paragraph 2', text: 'Two.', facts: [f('S1F1', 'Other.')], numbersNotFound: [] }], [], pool),
    ).toThrow(/share the id S1F1/)
  })
})
