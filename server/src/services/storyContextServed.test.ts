import { describe, it, expect } from 'vitest'
import { contextFact, sentenceBox } from '../test/contextFixtures.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { placeServed, servedBoxes, type ServableBox } from './storyContextServed.js'

const STORY_DAY = '2026-11-14'

const layout = {
  paragraphs: [{ id: 'P1', text: 'Fires burned.', sourceUrls: ['https://example.com/S0'] }],
  points: [{ id: 'W1', text: 'Smoke reaches millions.', sourceUrls: [] }],
}

const servable = (id: string, box: DraftBox, extra: Partial<ServableBox> = {}): ServableBox => ({
  id,
  type: box.type,
  hidden: false,
  place: box.place,
  placeByEditor: false,
  content: { sentences: box.sentences, visual: box.visual },
  ...extra,
})

const factsOf = (...facts: (ContextFactData & { demoted?: boolean })[]) => new Map(facts.map(f => [f.ref, f]))

const bars = (points: string[], apart: string[] = []): DraftBox['visual'] => ({
  kind: 'bars',
  measure: 'people evacuated',
  unit: 'people',
  points: points.map((factId, i) => ({ label: `${2024 + i}`, factId })),
  apart: apart.length === 0 ? null : { measure: 'area burned', unit: 'hectares', points: apart.map(factId => ({ label: 'Now', factId })) },
})

describe('servedBoxes', () => {
  const facts = factsOf(
    contextFact('S0F1'),
    contextFact('S0F2', { demoted: true }),
    contextFact('S0F3', { verdict: 'rejected' }),
    contextFact('S0F4', { value: null }),
    contextFact('S2F1', { value: 120 }),
  )

  it('serves the boxes not hidden that still show something, each with its shown sentences, tiles or chart', () => {
    const served = servedBoxes(
      [
        servable('hidden', sentenceBox('compared', ['S0F1']), { hidden: true }),
        servable('demoted fact', sentenceBox('compared', ['S0F2'])),
        servable('partly', {
          ...sentenceBox('why_now', ['S0F1']),
          sentences: [
            { text: 'Rejected.', factIds: ['S0F3'] },
            { text: 'Shown.', factIds: ['S0F1'] },
            { text: 'Cites nothing.', factIds: [] },
          ],
        }),
        servable('no value', sentenceBox('who_affected', [], { sentences: [], visual: { kind: 'tiles', tiles: [{ label: 'people', factIds: ['S0F4'] }] } })),
        servable('tiles', sentenceBox('who_affected', [], { sentences: [], visual: { kind: 'tiles', tiles: [{ label: 'people', factIds: ['S0F1'] }] } })),
        servable('one bar', sentenceBox('compared', [], { sentences: [], visual: bars(['S0F1']) })),
        servable('chart', sentenceBox('compared', [], { sentences: [], visual: bars(['S0F1', 'S2F1']) })),
      ],
      facts,
      STORY_DAY,
    )
    expect(served.map(s => s.box.id)).toEqual(['partly', 'tiles', 'chart'])
    expect(served[0]!.sentences.map(s => s.text)).toEqual(['Shown.'])
    expect(served[1]!.visual).toEqual({ kind: 'tiles', tiles: [{ label: 'people', values: [{ ref: 'S0F1', text: '100', estimate: false }] }] })
    expect(served[2]!.visual).toMatchObject({ kind: 'bars', points: [{ ref: 'S0F1' }, { ref: 'S2F1' }], apart: null })
  })

  it("takes each box's sources from every fact it cites, its chart's apart group included", () => {
    const withApart = factsOf(contextFact('S3F1'), contextFact('S3F2', { value: 120 }), contextFact('S0F1', { unit: 'hectares' }))
    const [served] = servedBoxes(
      [servable('chart', sentenceBox('compared', [], { sentences: [], visual: bars(['S3F1', 'S3F2'], ['S0F1']) }))],
      withApart,
      STORY_DAY,
    )
    expect(served!.sourceUrls).toEqual(['https://example.com/S3', 'https://example.com/S0'])
  })
})

describe('placeServed', () => {
  it('places only the boxes served, so a box left out takes no spot', () => {
    const facts = factsOf(contextFact('S0F1'), contextFact('S0F2', { demoted: true }))
    const served = servedBoxes(
      [servable('empty', sentenceBox('compared', ['S0F2'], { place: 'P1' })), servable('shown', sentenceBox('why_now', ['S0F1'], { place: 'P1' }))],
      facts,
      STORY_DAY,
    )
    expect(placeServed(served, { storyId: 'story-1', layout }).map(p => [p.box.id, p.place])).toEqual([['shown', 'P1']])
  })

  it("places under the configured mode unless another is named, a chart by its apart group's sources too", () => {
    const facts = factsOf(contextFact('S3F1'), contextFact('S3F2', { value: 120 }), contextFact('S0F1', { unit: 'hectares' }))
    const served = servedBoxes([servable('chart', sentenceBox('compared', [], { sentences: [], visual: bars(['S3F1', 'S3F2'], ['S0F1']) }))], facts, STORY_DAY)
    expect(placeServed(served, { storyId: 'story-1', layout })[0]!.place).toBe('section')
    expect(placeServed(served, { storyId: 'story-1', layout, mode: 'random' })[0]!.place).toBe('P1')
  })
})
