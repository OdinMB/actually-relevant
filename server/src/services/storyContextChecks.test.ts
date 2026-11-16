import { describe, it, expect } from 'vitest'
import {
  applyBoxVerdicts,
  asOfWords,
  boxCheckItems,
  boxCopying,
  factCheckItems,
  factVerdicts,
  itemTally,
  promptItems,
  renderFact,
  resolveVisuals,
  structuralBoxes,
  wordingSources,
  type ContextFactData,
  type DraftBox,
} from './storyContextChecks.js'
import type { BoxesAnswer } from '../schemas/storyContext.js'

const WINDOWS = { fastDays: 14, slowDays: 365 }
const DAY = '2026-11-14'

const contextFact = (over: Partial<ContextFactData> & { ref: string }): ContextFactData => ({
  origin: 'research',
  reusedFromId: null,
  slot: null,
  source: {
    id: over.ref.replace(/F\d+$/, ''),
    url: `https://${over.ref.toLowerCase()}.example/a`,
    outlet: 'Outlet',
    title: 'Title',
    date: '2026-11-12',
    kind: 'news-report',
  },
  supportingSentence: 'The fires burned 2.88 million hectares this year, the agency said.',
  passage: null,
  supportFound: true,
  statement: 'Fires burned 2.88 million hectares this year.',
  value: 2_880_000,
  valueHigh: null,
  unit: 'hectares',
  approx: 'exact',
  provisional: false,
  counted: 'area burned in Indonesia',
  place: 'Indonesia',
  asOf: '2026',
  credited: '',
  creditedKind: null,
  validity: 'fixed',
  verdict: 'supported',
  verdictProblem: null,
  model: 'm',
  promptVersion: 'v',
  ...over,
})

describe('renderFact', () => {
  it('renders a figure with what it counts, its qualifier, as-of date, credit and estimate', () => {
    expect(renderFact(contextFact({ ref: 'S1F1', approx: 'about', credited: "Indonesia's disaster agency", provisional: true }))).toBe(
      "Area burned in Indonesia: about 2.88 million hectares, as of 2026, according to Indonesia's disaster agency (estimate)",
    )
  })

  it('names a place the counted phrase leaves out, and a range with both ends', () => {
    expect(
      renderFact(contextFact({ ref: 'S1F1', counted: 'people killed', place: 'Riau', value: 5000, valueHigh: 5400, unit: 'people', asOf: '2026-11' })),
    ).toBe('People killed: 5,000 to 5,400 people, in Riau, as of November 2026')
  })

  it('renders a fact without a figure as its statement with its details', () => {
    expect(
      renderFact(
        contextFact({
          ref: 'S1F1',
          value: null,
          counted: '',
          place: '',
          statement: 'The ministry banned burning.',
          asOf: '2026-11-03',
          credited: 'the ministry',
        }),
      ),
    ).toBe('The ministry banned burning. (as of November 3, 2026, according to the ministry)')
    expect(renderFact(contextFact({ ref: 'S1F1', value: null, counted: '', place: '', asOf: null, statement: 'A ban is planned.', provisional: true }))).toBe(
      'A ban is planned. (provisional)',
    )
  })

  it('puts a figure without a counted phrase beside the statement', () => {
    expect(renderFact(contextFact({ ref: 'S1F1', counted: '', place: '', asOf: null }))).toBe(
      'Fires burned 2.88 million hectares this year. (2.88 million hectares)',
    )
  })

  it('writes coarse as-of dates as coarsely', () => {
    expect([asOfWords('2015'), asOfWords('2026-03'), asOfWords('2026-03-09')]).toEqual(['2015', 'March 2026', 'March 9, 2026'])
  })
})

describe('factCheckItems', () => {
  it("judges each fact against its source's sentence, or a search fact's passage, plus the source's date fact", () => {
    const [research, search] = factCheckItems([
      contextFact({ ref: 'S1F1' }),
      contextFact({ ref: 'S7F2', origin: 'search', passage: 'Before. The fires burned 2.88 million hectares this year, the agency said. After.' }),
    ])
    expect(research!.item).toMatchObject({ label: 'Fact S1F1', factIds: ['S1F1'], cited: true })
    expect(research!.evidence.map(e => [e.id, e.supportingSentence])).toEqual([
      ['S1F1', 'The fires burned 2.88 million hectares this year, the agency said.'],
      ['S1F0', ''],
    ])
    expect(research!.evidence[1]!.statement).toBe('Outlet published this on Thursday, November 12, 2026.')
    expect(search!.evidence[0]!.supportingSentence).toMatch(/^Before\./)
  })

  it("gives production's number hints: a number the evidence does not state", () => {
    const [item] = factCheckItems([contextFact({ ref: 'S1F1', value: 3_100_000 })])
    expect(item!.numberHints).toEqual(['3.1 million'])
    expect(promptItems([item!])[0]).toMatchObject({ label: 'Fact S1F1', numbersNotFound: ['3.1 million'] })
  })

  it('reads the verdicts: a problem rejects, no answer leaves the fact unjudged', () => {
    const items = factCheckItems([contextFact({ ref: 'S1F1' }), contextFact({ ref: 'S1F2' }), contextFact({ ref: 'S1F3' })])
    const verdict = (number: number, supported: boolean) => ({
      number,
      supported,
      problem: supported ? '' : 'the sentence says 2.6 million',
      key: false,
      copiedSentence: '',
      followsSource: '',
    })
    const verdicts = factVerdicts({ items: [verdict(1, true), verdict(2, false)] }, items)
    expect(Object.fromEntries(verdicts)).toEqual({
      S1F1: { verdict: 'supported', problem: null },
      S1F2: { verdict: 'rejected', problem: 'fails the fact check: the sentence says 2.6 million' },
      S1F3: { verdict: 'unjudged', problem: null },
    })
  })
})

const facts = new Map(
  [
    contextFact({
      ref: 'S1F1',
      value: 12_500_000,
      unit: 'people',
      counted: 'people under hazardous smoke',
      place: 'Southeast Asia',
      validity: 'fast',
      asOf: '2026-11-10',
    }),
    contextFact({ ref: 'S1F2', value: 2_600_000, asOf: '2015' }),
    contextFact({ ref: 'S2F1', value: 2_880_000, provisional: true, asOf: '2026' }),
    contextFact({ ref: 'S2F2', value: 400_000, unit: 'people', counted: 'people evacuated', validity: 'fast', asOf: '2026-09-01' }),
  ].map(f => [f.ref, f]),
)

const answer = (over: Partial<BoxesAnswer> = {}): BoxesAnswer => ({
  figures: { heading: 'In numbers', teaser: 'Key figures', tiles: [{ label: 'people under smoke', factIds: ['S1F1'] }] },
  boxes: [
    {
      slot: 'compared',
      heading: 'Bigger than 2015',
      teaser: 'Past the 2015 record',
      place: 'P2',
      sentences: [
        { text: 'The 2015 fires burned 2.6 million hectares.', factIds: ['S1F2'] },
        { text: 'An unknown claim.', factIds: ['S9F9'] },
        { text: 'No citation.', factIds: [] },
      ],
      visual: {
        kind: 'bars',
        tiles: [],
        measure: 'area burned in Indonesia',
        unit: 'hectares',
        points: [
          { label: '2015', factId: 'S1F2' },
          { label: '2026', factId: 'S2F1' },
        ],
        apart: null,
      },
    },
  ],
  ...over,
})

describe('structuralBoxes', () => {
  it('drops a sentence, tile or point citing anything but a supported fact, and a place the story lacks', () => {
    const written = answer()
    written.boxes[0]!.visual.points.push({ label: '2030', factId: 'S8F1' })
    const { boxes, drops, structural } = structuralBoxes(written, new Set(facts.keys()), new Set(['P1', 'W1']))
    expect(boxes.map(b => [b.type, b.place, b.sentences.length])).toEqual([
      ['figures', null, 0],
      ['compared', null, 1],
    ])
    expect(drops.map(d => d.label)).toEqual(['Box 2 sentence 2', 'Box 2 sentence 3', 'Box 2 chart point 3'])
    expect(structural).toBe(3)
  })

  it('keeps an existing place', () => {
    expect(structuralBoxes(answer(), new Set(facts.keys()), new Set(['P2'])).boxes[1]!.place).toBe('P2')
  })
})

describe('resolveVisuals and boxCheckItems', () => {
  const boxes = () => structuralBoxes(answer(), new Set(facts.keys()), new Set(['P2'])).boxes

  it('reads a sentence, a tile and a chart as the check judges them', () => {
    const { boxes: resolved } = resolveVisuals(boxes(), facts, DAY, WINDOWS)
    const items = boxCheckItems(resolved, facts, DAY, WINDOWS)
    expect(items.map(i => [i.checked.item.label, i.checked.item.text, i.checked.item.factIds])).toEqual([
      ['Box 1 tile 1', 'people under smoke: 12.5 million people', ['S1F1']],
      ['Box 2 sentence 1', 'The 2015 fires burned 2.6 million hectares.', ['S1F2']],
      ['Box 2 chart', 'area burned in Indonesia, hectares: 2015, 2.6 million; 2026, 2.88 million (estimate)', ['S1F2', 'S2F1']],
    ])
    expect(items[2]!.checked.evidence.map(e => e.id)).toEqual(['S1F2', 'S2F1', 'S1F0', 'S2F0'])
  })

  it('drops an expired tile and an undrawable chart without counting them', () => {
    const written = answer({ figures: { heading: 'h', teaser: 't', tiles: [{ label: 'evacuated', factIds: ['S2F2'] }] } })
    written.boxes[0]!.visual.points.pop()
    const resolved = resolveVisuals(structuralBoxes(written, new Set(facts.keys()), new Set()).boxes, facts, DAY, WINDOWS)
    expect(resolved.drops).toEqual([
      { label: 'Box 1 tile 1', cause: 'expired' },
      { label: 'Box 2 chart', cause: 'undrawn' },
    ])
    expect(resolved.boxes.map(b => b.visual)).toEqual([null, null])
    expect(boxCheckItems(resolved.boxes, facts, DAY, WINDOWS)).toHaveLength(1)
  })
})

describe('applyBoxVerdicts', () => {
  const verdict = (number: number, supported: boolean, copiedSentence = '') => ({
    number,
    supported,
    problem: supported ? '' : 'not stated',
    key: false,
    copiedSentence,
    followsSource: '',
  })

  it('drops failed and unanswered items, a chart with its apart group, and boxes left empty', () => {
    const resolved = resolveVisuals(structuralBoxes(answer(), new Set(facts.keys()), new Set()).boxes, facts, DAY, WINDOWS).boxes
    const items = boxCheckItems(resolved, facts, DAY, WINDOWS)
    // tile 1 fails, sentence passes, chart unanswered
    const result = applyBoxVerdicts(resolved, items, [{ answer: { items: [verdict(1, false), verdict(2, true)] }, items }], [], [])
    expect(result.boxes.map(b => [b.type, b.sentences.length, b.visual])).toEqual([['compared', 1, null]])
    expect(result.drops.map(d => [d.label, d.cause])).toEqual([
      ['Box 1 tile 1', 'check'],
      ['Box 2 chart', 'unjudged'],
      ['Box 1', 'empty'],
    ])
    expect([result.judged, result.failed]).toEqual([3, 2])
  })

  it("drops a sentence the code's copying check flags", () => {
    const box: DraftBox = {
      type: 'why_now',
      heading: 'h',
      teaser: 't',
      place: null,
      sentences: [{ text: 'Officials said the fires burned across the dry peat of the southern provinces for many weeks.', factIds: ['S1F2'] }],
      visual: null,
      gap: false,
    }
    const long = contextFact({
      ref: 'S1F2',
      supportingSentence: 'The fires burned across the dry peat of the southern provinces for many weeks, officials said.',
    })
    const copying = boxCopying([box], wordingSources([long], new Map()), 12)
    expect(copying).toHaveLength(1)
    const items = boxCheckItems([box], facts, DAY, WINDOWS)
    const result = applyBoxVerdicts([box], items, [{ answer: { items: [verdict(1, true)] }, items }], [], copying)
    expect(result.boxes).toEqual([])
    expect(result.drops[0]).toMatchObject({ label: 'Box 1 sentence 1', cause: 'copying' })
  })
})

describe('itemTally', () => {
  it('counts unjudged and left-out facts as failed, and structural drops', () => {
    expect(itemTally({ supported: 10, rejected: 2, unjudged: 1, leftOut: 3, boxStructural: 1, boxJudged: 8, boxFailed: 2 })).toEqual({ checked: 25, failed: 9 })
  })
})
