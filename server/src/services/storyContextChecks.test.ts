import { describe, it, expect } from 'vitest'
import { buildFactCheckPrompt, FACT_RECORD } from '../prompts/research.js'
import {
  applyBoxVerdicts,
  asOfWords,
  boxCheckItems,
  boxCopying,
  factCheckItems,
  factVerdicts,
  itemTally,
  promptItems,
  RECORD_LABELS,
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
  /** A fact without a figure or any detail: only what a case sets shows in its record. */
  const bare = (over: Partial<ContextFactData>) =>
    contextFact({ ref: 'S1F1', value: null, unit: '', counted: '', place: '', asOf: null, credited: '', provisional: false, ...over })

  it('gives the statement, then the whole record in order, the place shown though the counted phrase names it', () => {
    expect(renderFact(contextFact({ ref: 'S1F1', approx: 'about', credited: "Indonesia's disaster agency", provisional: true }))).toBe(
      "Fires burned 2.88 million hectares this year. [Record: figure: about 2.88 million hectares; counts: area burned in Indonesia; place: Indonesia; as of: 2026; credited to: Indonesia's disaster agency; estimate]",
    )
  })

  it('records a range with both ends', () => {
    expect(
      renderFact(
        contextFact({
          ref: 'S1F1',
          statement: 'Between 5,000 and 5,400 people died in Riau.',
          counted: 'people killed',
          place: 'Riau',
          value: 5000,
          valueHigh: 5400,
          unit: 'people',
          asOf: '2026-11',
        }),
      ),
    ).toBe('Between 5,000 and 5,400 people died in Riau. [Record: figure: 5,000 to 5,400 people; counts: people killed; place: Riau; as of: November 2026]')
  })

  it("records a figureless fact's details, and its flag as provisional", () => {
    expect(renderFact(bare({ statement: 'The ministry banned burning.', asOf: '2026-11-03', credited: 'the ministry' }))).toBe(
      'The ministry banned burning. [Record: as of: November 3, 2026; credited to: the ministry]',
    )
    expect(renderFact(bare({ statement: 'A ban is planned.', provisional: true }))).toBe('A ban is planned. [Record: provisional]')
  })

  it('gives a fact with no field set as its statement alone, trimmed', () => {
    expect(renderFact(bare({ statement: '  A ban is planned. ' }))).toBe('A ban is planned.')
  })

  it('leaves out what a figure counts when the fact names nothing', () => {
    expect(renderFact(contextFact({ ref: 'S1F1', counted: '', place: '', asOf: null }))).toBe(
      'Fires burned 2.88 million hectares this year. [Record: figure: 2.88 million hectares]',
    )
  })

  it('never shows a filler stored in the place, the credit or the thing counted', () => {
    expect(renderFact(contextFact({ ref: 'S1F1', counted: 'n/a', place: 'Unknown', asOf: null, credited: 'None.' }))).toBe(
      'Fires burned 2.88 million hectares this year. [Record: figure: 2.88 million hectares]',
    )
  })

  it('writes the record with the labels the prompts quote for it', () => {
    // The prompts describe the record in fixed text; a label changed here alone would leave them describing another format
    const L = RECORD_LABELS
    const quoted = `[${L.record}: ${L.figure}: …; ${L.counts}: …; ${L.place}: …; ${L.asOf}: …; ${L.credited}: …; ${L.estimate}]`
    expect(FACT_RECORD).toContain(quoted)
    expect(FACT_RECORD).toContain(`"${L.provisional}"`)
    expect(buildFactCheckPrompt([], [], [])).toContain(quoted)
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
  boxes: [
    {
      slot: 'who_affected',
      heading: 'Who the smoke reaches',
      teaser: 'Millions under the haze',
      place: 'section',
      sentences: [],
      visual: { kind: 'tiles', tiles: [{ label: 'people under smoke', factIds: ['S1F1'] }], measure: '', unit: '', points: [], apart: null },
    },
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
    written.boxes[1]!.visual.points.push({ label: '2030', factId: 'S8F1' })
    written.boxes[0]!.visual.tiles.push({ label: 'unknown', factIds: ['S9F9'] })
    const { boxes, drops, structural } = structuralBoxes(written, new Set(facts.keys()), new Set(['P1', 'W1']))
    expect(boxes.map(b => [b.type, b.place, b.sentences.length])).toEqual([
      ['who_affected', null, 0],
      ['compared', null, 1],
    ])
    expect(drops.map(d => d.label)).toEqual(['Box 1 tile 2', 'Box 2 sentence 2', 'Box 2 sentence 3', 'Box 2 chart point 3'])
    expect(structural).toBe(4)
  })

  it('keeps an existing place', () => {
    expect(structuralBoxes(answer(), new Set(facts.keys()), new Set(['P2'])).boxes[1]!.place).toBe('P2')
  })

  const box = (slot: BoxesAnswer['boxes'][number]['slot'], heading: string, over: Partial<BoxesAnswer['boxes'][number]> = {}) => ({
    slot,
    heading,
    teaser: 't',
    place: 'section',
    sentences: [{ text: `${heading}.`, factIds: ['S1F2'] }],
    visual: { kind: 'none' as const, tiles: [], measure: '', unit: '', points: [], apart: null },
    ...over,
  })
  const caps = { boxes: 3, sentences: 2, tiles: 2 }

  it('keeps the first box of each slot and at most the cap of boxes, counting each one dropped as structural', () => {
    const written = answer({
      boxes: [box('compared', 'First compared'), box('compared', 'Second compared'), box('why_now', 'Why now'), box('next', 'Next'), box('key_term', 'Term')],
    })
    const { boxes, drops, structural } = structuralBoxes(written, new Set(facts.keys()), new Set(), caps)
    expect(boxes.map(b => b.heading)).toEqual(['First compared', 'Why now', 'Next'])
    expect(drops).toEqual([
      { label: 'Box "Second compared"', cause: 'structure', problem: 'a second box for its slot' },
      { label: 'Box "Term"', cause: 'structure', problem: 'over the 3 boxes' },
    ])
    expect(structural).toBe(2)
  })

  it('keeps at most the cap of sentences and of tiles, in the order written', () => {
    const sentences = ['One', 'Two', 'Three'].map(text => ({ text, factIds: ['S1F2'] }))
    const tiles = ['a', 'b', 'c'].map(label => ({ label, factIds: ['S1F1'] }))
    const visual = { kind: 'tiles' as const, tiles, measure: '', unit: '', points: [], apart: null }
    const written = answer({
      boxes: [box('who_affected', 'Who', { sentences: [], visual }), box('compared', 'Compared', { sentences, visual })],
    })
    const { boxes, drops } = structuralBoxes(written, new Set(facts.keys()), new Set(), caps)
    expect(boxes.map(b => [b.sentences.map(s => s.text), b.visual?.kind === 'tiles' ? b.visual.tiles.map(t => t.label) : null])).toEqual([
      [[], ['a', 'b']],
      [
        ['One', 'Two'],
        ['a', 'b'],
      ],
    ])
    expect(drops.map(d => [d.label, d.problem])).toEqual([
      ['Box 1 tile 3', 'over the 2 tiles'],
      ['Box 2 sentence 3', 'over the 2 sentences'],
      ['Box 2 tile 3', 'over the 2 tiles'],
    ])
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

  it('judges a tile without a label by its heading, which then says what the number counts', () => {
    const written = answer()
    written.boxes[0]!.heading = 'People under hazardous smoke'
    written.boxes[0]!.visual.tiles[0]!.label = ' '
    const { boxes: resolved } = resolveVisuals(structuralBoxes(written, new Set(facts.keys()), new Set()).boxes, facts, DAY, WINDOWS)
    expect(boxCheckItems(resolved, facts, DAY, WINDOWS)[0]!.checked.item.text).toBe('People under hazardous smoke: 12.5 million people')
  })

  it('drops an expired tile and an undrawable chart without counting them', () => {
    const written = answer()
    written.boxes[0]!.visual.tiles = [{ label: 'evacuated', factIds: ['S2F2'] }]
    written.boxes[1]!.visual.points.pop()
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
