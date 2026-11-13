import { describe, it, expect } from 'vitest'
import type { Draft, Repair } from '../schemas/research.js'
import type { CitationProblem } from './researchChecks.js'
import { afterRecheck, derivableLabels, repairTargets, storyItems, withDerived, withRepairs } from './researchRepair.js'

type Parts = Pick<Draft, 'title' | 'story' | 'whyThisMatters' | 'caveats' | 'summary' | 'marketingBlurb' | 'quote' | 'quoteAttribution' | 'quoteSourceId'>

const draft = (): Parts => ({
  title: 'Rooftop panels spread',
  story: [
    { text: 'Pakistan added 22 GW of rooftop solar.', factIds: ['S0F1'] },
    { text: 'The boom cut grid demand.', factIds: ['S1F2'] },
  ],
  whyThisMatters: [
    { text: 'Cheap power reaches millions.', factIds: [] },
    { text: 'Factories pay less.', factIds: ['S1F1'] },
  ],
  caveats: [{ text: 'The grid lags behind.', factIds: [] }],
  summary: 'Households add panels.',
  marketingBlurb: 'Panels spread fast.',
  quote: 'We have added 22GW',
  quoteAttribution: 'Prime minister',
  quoteSourceId: 'S0',
})

const problem = (label: string, over: Partial<CitationProblem> = {}): CitationProblem => ({
  label,
  text: '',
  problem: `${label} fails`,
  kind: 'fact',
  by: 'judge',
  ...over,
})

const answer = (items: Repair['items'], quote: Partial<Pick<Repair, 'quote' | 'quoteAttribution' | 'quoteSourceId'>> = {}): Repair => ({
  items,
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  ...quote,
})

describe('repairTargets', () => {
  it('names each failing item once, in the draft order with the key quote last, with all its problems and its citations', () => {
    const targets = repairTargets(draft(), [
      problem('Key quote'),
      problem('Story paragraph 2', { problem: 'renders S1F2 closely', kind: 'copying' }),
      problem('Blurb', { kind: 'copying' }),
      problem('Story paragraph 2', { problem: 'cites S9F9, which is not among the facts', by: 'code' }),
    ])
    expect(targets).toEqual([
      {
        label: 'Story paragraph 2',
        text: 'The boom cut grid demand.',
        factIds: ['S1F2'],
        problems: ['renders S1F2 closely', 'cites S9F9, which is not among the facts'],
      },
      { label: 'Blurb', text: 'Panels spread fast.', factIds: null, problems: ['Blurb fails'] },
      {
        label: 'Key quote',
        text: 'We have added 22GW',
        factIds: null,
        quote: { attribution: 'Prime minister', sourceId: 'S0' },
        problems: ['Key quote fails'],
      },
    ])
  })
})

describe('storyItems', () => {
  it('gives every item of the draft by label, the key quote with its speaker, and no key quote once it is empty', () => {
    expect(storyItems(draft()).map(i => i.label)).toEqual([
      'Title',
      'Story paragraph 1',
      'Story paragraph 2',
      'Why This Matters 1',
      'Why This Matters 2',
      'Caveat 1',
      'Summary',
      'Blurb',
      'Key quote',
    ])
    expect(storyItems(draft()).at(-1)).toEqual({ label: 'Key quote', text: 'We have added 22GW (Prime minister)' })
    expect(storyItems({ ...draft(), quote: '' }).map(i => i.label)).not.toContain('Key quote')
  })
})

describe('withRepairs', () => {
  const failing = () => repairTargets(draft(), [problem('Story paragraph 2'), problem('Summary'), problem('Why This Matters 2')])

  it('takes the new texts of the failing items alone, and leaves every other item as it was', () => {
    const out = withRepairs(
      draft(),
      answer([
        { label: 'Story paragraph 2', text: 'Grid demand fell as homes went solar.', factIds: ['S1F2', 'S0F1'] },
        { label: 'Story paragraph 1', text: 'A passing paragraph the answer should not touch.', factIds: [] },
        { label: 'Title', text: 'Not asked for', factIds: [] },
        { label: 'Summary', text: 'Homes add panels fast.', factIds: ['S0F1'] },
        { label: 'Caveat 9', text: 'No such item', factIds: [] },
      ]),
      failing(),
    )
    expect(out.rewritten).toEqual(['Story paragraph 2', 'Summary'])
    expect(out.draft).toEqual({
      ...draft(),
      story: [draft().story[0], { text: 'Grid demand fell as homes went solar.', factIds: ['S1F2', 'S0F1'] }],
      // The summary cites nothing, whatever ids the answer gives it
      summary: 'Homes add panels fast.',
    })
  })

  it('counts an empty text, a text the same as before and a second answer for a label for nothing', () => {
    const out = withRepairs(
      draft(),
      answer([
        { label: 'Story paragraph 2', text: '  ', factIds: [] },
        { label: 'Why This Matters 2', text: 'Factories pay less.', factIds: ['S1F1'] },
        { label: 'Summary', text: 'Homes add panels fast.', factIds: [] },
        { label: 'Summary', text: 'A second answer for it.', factIds: [] },
      ]),
      failing(),
    )
    expect(out.rewritten).toEqual(['Summary'])
    expect(out.draft).toEqual({ ...draft(), summary: 'Homes add panels fast.' })
  })

  it('takes a bullet with new citations and the same text as rewritten', () => {
    const out = withRepairs(draft(), answer([{ label: 'Why This Matters 2', text: 'Factories pay less.', factIds: [] }]), failing())
    expect(out.rewritten).toEqual(['Why This Matters 2'])
    expect(out.draft.whyThisMatters[1]).toEqual({ text: 'Factories pay less.', factIds: [] })
  })

  it('takes a new key quote with its speaker and source only when the key quote failed', () => {
    const quote = { quote: 'Our roofs now carry 22GW', quoteAttribution: 'Shehbaz Sharif, prime minister', quoteSourceId: 'S1' }
    expect(withRepairs(draft(), answer([], quote), failing())).toEqual({ draft: draft(), rewritten: [] })
    const out = withRepairs(draft(), answer([], quote), repairTargets(draft(), [problem('Key quote')]))
    expect(out).toEqual({ draft: { ...draft(), ...quote }, rewritten: ['Key quote'] })
  })
})

describe('afterRecheck', () => {
  it("keeps every item's problems but the rechecked ones', which the new pass replaces", () => {
    const before = [problem('Story paragraph 2'), problem('Why This Matters 2'), problem('Key quote')]
    const pass = { problems: [problem('Story paragraph 2', { problem: 'still fails' })], rechecked: ['Story paragraph 2', 'Key quote'] }
    expect(afterRecheck(before, pass)).toEqual([problem('Why This Matters 2'), problem('Story paragraph 2', { problem: 'still fails' })])
  })
})

describe('derivableLabels', () => {
  it('names the title, summary and blurb still failing on copying alone, never one with a fact problem or another item', () => {
    expect(
      derivableLabels([
        problem('Blurb', { kind: 'copying' }),
        problem('Title', { kind: 'copying', by: 'code' }),
        problem('Title', { kind: 'copying' }),
        problem('Summary', { kind: 'copying' }),
        problem('Summary', { kind: 'fact' }),
        problem('Story paragraph 1', { kind: 'copying' }),
      ]),
    ).toEqual(['Title', 'Blurb'])
    expect(derivableLabels([])).toEqual([])
  })
})

describe('withDerived', () => {
  const derived = { title: 'Homes go solar', summary: 'A new summary.', marketingBlurb: 'A new blurb.' }

  it('takes only the fields it names, and counts an empty or unchanged one for nothing', () => {
    expect(withDerived(draft(), derived, ['Blurb'])).toEqual({ draft: { ...draft(), marketingBlurb: 'A new blurb.' }, rewritten: ['Blurb'] })
    expect(withDerived(draft(), { ...derived, title: ' ', summary: 'Households add panels.' }, ['Title', 'Summary'])).toEqual({ draft: draft(), rewritten: [] })
  })
})
