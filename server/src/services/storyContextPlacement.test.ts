import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { placeBoxes, type PlacementBox, type PlacementOptions } from './storyContextPlacement.js'
import { parsePoints, storyLayout } from './storyContextLayout.js'

const layout = {
  paragraphs: [
    { id: 'P1', text: 'One', sourceUrls: ['https://a.example/1'] },
    { id: 'P2', text: 'Two', sourceUrls: ['https://www.b.example/2/'] },
    { id: 'P3', text: 'Three', sourceUrls: ['https://a.example/1'] },
  ],
  points: [
    { id: 'W1', text: 'Why one', sourceUrls: ['https://a.example/1'] },
    { id: 'W2', text: 'Why two', sourceUrls: [] },
    { id: 'W3', text: 'Why three', sourceUrls: ['https://b.example/2'] },
  ],
}

const box = (id: string, over: Partial<PlacementBox> = {}): PlacementBox => ({
  id,
  place: null,
  placeByEditor: false,
  sourceUrls: ['https://a.example/1'],
  ...over,
})

const options = (mode: PlacementOptions['mode']): PlacementOptions => ({ mode, storyId: 'story-1', notesInText: 2, notesByPoints: 2 })

const placesOf = (boxes: PlacementBox[], mode: PlacementOptions['mode']) => Object.fromEntries(placeBoxes(boxes, layout, options(mode)))

describe('placeBoxes', () => {
  it('model: keeps stored places within the limits, the extras to the section in box order, one note per spot', () => {
    const boxes = [
      box('a', { place: 'P1' }),
      box('b', { place: 'P1' }),
      box('c', { place: 'P2' }),
      box('d', { place: 'P3' }),
      box('e', { place: 'W1' }),
      box('f', { place: 'W2' }),
      box('g', { place: 'W3' }),
      box('h', { place: null }),
    ]
    expect(placesOf(boxes, 'model')).toEqual({ a: 'P1', b: 'section', c: 'P2', d: 'section', e: 'W1', f: 'W2', g: 'section', h: 'section' })
  })

  it('puts a box whose place the story no longer has in the section', () => {
    expect(placesOf([box('gone', { place: 'P9' }), box('kept', { place: 'P1' })], 'model')).toEqual({ gone: 'section', kept: 'P1' })
  })

  it('section: places nothing beside the text', () => {
    expect(placesOf([box('a', { place: 'P1' }), box('b', { place: 'W1' })], 'section')).toEqual({ a: 'section', b: 'section' })
  })

  it("random: picks only spots citing one of the box's sources, the same for the same story, a second search's box to the section", () => {
    const boxes = [box('a'), box('b', { sourceUrls: ['https://b.example/2'] }), box('c', { sourceUrls: ['https://new.example/x'] })]
    const first = placesOf(boxes, 'random')
    expect(['P1', 'P3', 'W1']).toContain(first.a)
    expect(['P2', 'W3']).toContain(first.b)
    expect(first.c).toBe('section')
    expect(placesOf(boxes, 'random')).toEqual(first)
    const other = Object.fromEntries(placeBoxes(boxes, layout, { ...options('random'), storyId: 'story-2' }))
    expect(['P1', 'P3', 'W1']).toContain(other.a)
  })

  it("keeps an editor's place in every mode, first and under the same limits", () => {
    const boxes = [box('a', { place: 'P1' }), box('b', { place: 'P2' }), box('ed', { place: 'P3', placeByEditor: true })]
    for (const mode of ['model', 'random', 'section'] as const) expect(placesOf(boxes, mode).ed).toBe('P3')
    expect(placesOf(boxes, 'model')).toEqual({ ed: 'P3', a: 'P1', b: 'section' })
    expect(placesOf([box('ed', { place: 'P9', placeByEditor: true })], 'model')).toEqual({ ed: 'section' })
  })
})

describe('storyLayout', () => {
  const research = {
    paragraphs: [
      {
        sentences: [
          {
            text: 'First.',
            citations: [
              { sourceId: 'S0', sentence: 'x' },
              { sourceId: 'E1', sentence: null },
            ],
          },
        ],
      },
      { sentences: [{ text: 'Second.', citations: [{ sourceId: 'S2', sentence: 'y' }] }] },
    ],
    whyThisMatters: [{ text: 'Because.', citations: [{ sourceId: 'S2', sentence: 'y' }] }],
    caveats: [{ text: 'But.', citations: [] }],
    quoteSourceId: null,
    sources: [
      {
        id: 'S0',
        origin: 'original',
        outlet: 'A',
        host: 'a.example',
        url: 'https://a.example/1',
        title: 't',
        date: null,
        country: null,
        kind: 'news-report',
        storyId: null,
        slug: null,
      },
      {
        id: 'S2',
        origin: 'source',
        outlet: 'B',
        host: 'b.example',
        url: 'https://b.example/2',
        title: 't',
        date: null,
        country: null,
        kind: 'analysis',
        storyId: null,
        slug: null,
      },
      {
        id: 'E1',
        origin: 'earlier',
        outlet: 'Actually Relevant',
        host: null,
        url: null,
        title: 't',
        date: '2026-11-01',
        country: null,
        kind: null,
        storyId: 'e',
        slug: 'e',
      },
    ],
  }

  it("numbers a researched story's paragraphs and points, each with the URLs it cites", () => {
    expect(storyLayout({ url: 'https://a.example/1', summary: 'S', relevanceReasons: null, antifactors: null, research })).toEqual({
      paragraphs: [
        { id: 'P1', text: 'First.', sourceUrls: ['https://a.example/1'] },
        { id: 'P2', text: 'Second.', sourceUrls: ['https://b.example/2'] },
      ],
      points: [{ id: 'W1', text: 'Because.', sourceUrls: ['https://b.example/2'] }],
      caveats: ['But.'],
    })
  })

  it("takes a single-source story's summary as one paragraph and splits its points as the page does", () => {
    const layout = storyLayout({
      url: 'https://a.example/1',
      summary: 'Para one.\n\nPara two.',
      relevanceReasons: '- **A:** one\n- two\n  more',
      antifactors: 'c1\nc2',
      research: null,
    })
    expect(layout.paragraphs).toEqual([{ id: 'P1', text: 'Para one.\n\nPara two.', sourceUrls: ['https://a.example/1'] }])
    expect(layout.points.map(p => [p.id, p.text])).toEqual([
      ['W1', '**A:** one'],
      ['W2', 'two more'],
    ])
    expect(layout.caveats).toEqual(['c1', 'c2'])
    expect(storyLayout({ url: 'u', summary: null, relevanceReasons: null, antifactors: null, research: { bad: true } })).toEqual({
      paragraphs: [],
      points: [],
      caveats: [],
    })
  })

  // The case table the client's parsePoints runs too (client/src/lib/parse-points.test.ts)
  const table = JSON.parse(readFileSync(new URL('../../../shared/fixtures/parse-points.json', import.meta.url), 'utf8')) as {
    cases: { name: string; text: string; points: string[] }[]
  }

  it.each(table.cases)('splits points as the page does: $name', ({ text, points }) => {
    expect(parsePoints(text)).toEqual(points)
  })
})
