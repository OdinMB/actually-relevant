import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { contextFact, contextResult, gapKey, sentenceBox } from '../../../test/contextFixtures.js'
import { halfOf, inHalf, scoreContext, scoreFields, storyScore, wastedSearches, type FieldLabel, type StoryRun } from './contextScore.js'

const search = (slot: 'compared' | 'response' | 'key_term', kept: string[]) => ({
  slot,
  wanted: 'w',
  query: `q ${slot}`,
  recent: false,
  cached: false,
  credits: 1,
  results: kept.length,
  kept,
})

describe('halfOf', () => {
  it("splits by the parity of the first byte of the slug's sha256", () => {
    for (const slug of ['a', 'b', 'indonesia-s-fires-burn-nearly-3-million-hectares', 'x-y-z']) {
      const even = createHash('sha256').update(slug).digest()[0]! % 2 === 0
      expect(halfOf(slug)).toBe(even ? 'tune' : 'judge')
    }
  })

  it('keeps a story in its half, and every story in all', () => {
    expect(inHalf('a', halfOf('a'))).toBe(true)
    expect(inHalf('a', halfOf('a') === 'tune' ? 'judge' : 'tune')).toBe(false)
    expect(inHalf('a', 'all')).toBe(true)
  })
})

describe('wastedSearches', () => {
  it('counts a search none of whose sources gave a supported fact a kept box cites', () => {
    const result = contextResult(
      {
        facts: [
          contextFact('S3F1', { origin: 'search', source: { ...contextFact('S3F1').source, url: 'https://a.org/1' } }),
          contextFact('S4F1', { origin: 'search', source: { ...contextFact('S4F1').source, url: 'https://b.org/1' }, verdict: 'rejected' }),
          contextFact('S5F1', { origin: 'search', source: { ...contextFact('S5F1').source, url: 'https://c.org/1' } }),
        ],
        boxes: [sentenceBox('compared', ['S3F1']), sentenceBox('response', ['S4F1'])],
      },
      { searches: [search('compared', ['https://a.org/1']), search('response', ['https://b.org/1']), search('key_term', ['https://c.org/1'])] },
    )
    expect(wastedSearches(result).map(s => s.slot)).toEqual(['response', 'key_term'])
  })
})

describe('storyScore', () => {
  const key = gapKey()
  const result = contextResult(
    {
      facts: [contextFact('S0F1'), contextFact('S3F1', { origin: 'search' })],
      boxes: [sentenceBox('compared', ['S0F1']), sentenceBox('response', ['S3F1'])],
      credits: 3,
      modelUsd: 0.02,
    },
    { searches: [search('response', []), search('key_term', [])] },
  )

  it('scores recall over the must needs the story does not state, searches, the response and the cost', () => {
    const run: StoryRun = {
      slug: 'story-a',
      run: 1,
      key,
      result,
      needs: [
        { id: 'record', met: true, factIds: ['S0F1'], why: '' },
        { id: 'response', met: false, factIds: [], why: '' },
        { id: 'term', met: true, factIds: [], why: '' },
      ],
      items: [
        { label: 'Box 1 sentence 1', text: 'A sentence.', supported: true, problem: '' },
        { label: 'Box 2 sentence 1', text: 'A sentence.', supported: false, problem: 'not stated' },
      ],
      notes: [
        { mode: 'model', box: 0, place: 'P1', adds: true, why: '' },
        { mode: 'random', box: 0, place: 'W1', adds: false, why: '' },
      ],
    }
    const s = storyScore(run)
    expect(s.needs).toEqual({ must: 2, met: 1, unmet: ['response'] })
    expect(s.searches).toEqual({ total: 2, wasted: 2, notNeeded: 0 })
    expect(s.response).toEqual({ findable: true, card: true, gap: false })
    expect(s.boxes).toEqual({ judged: 2, unsupported: 1, unjudged: 0 })
    expect(s.placement.model).toEqual({ notes: 1, adds: 1, unjudged: 0 })
    expect(s.placement.random).toEqual({ notes: 1, adds: 0, unjudged: 0 })
    // Model at the flex factor plus credits at the eval's Tavily price
    expect(s.costUsd).toBeCloseTo(0.02 * 0.5 + 3 * 0.008)
  })

  it('counts a search for a slot the key does not need, and a response the key has no source for', () => {
    const k = gapKey({
      needs: gapKey().needs.map(n => (n.slot === 'response' ? { ...n, example: null } : n)),
      notNeeded: [{ slot: 'key_term', why: 'w' }],
    })
    const s = storyScore({
      slug: 'story-a',
      run: 1,
      key: k,
      result: contextResult({}, { honestGap: true, searches: [search('key_term', [])] }),
      needs: null,
      items: null,
      notes: null,
    })
    expect(s.searches.notNeeded).toBe(1)
    expect(s.response).toEqual({ findable: false, card: false, gap: true })
    expect(s.needs).toEqual({ must: 2, met: 0, unmet: ['record', 'response'] })
    expect(s.boxes).toEqual({ judged: 0, unsupported: 0, unjudged: 0 })
  })

  it('does not count a response need the story itself states as findable', () => {
    const k = gapKey({ needs: gapKey().needs.map(n => (n.slot === 'response' ? { ...n, inStory: 'the program started' } : n)) })
    expect(storyScore({ slug: 'story-a', run: 1, key: k, result, needs: null, items: null, notes: null }).response.findable).toBe(false)
  })
})

describe('scoreContext', () => {
  const run = (n: number, met: boolean, wasted: number, costUsd: number): StoryRun => ({
    slug: 'story-a',
    run: n,
    key: gapKey(),
    result: contextResult(
      { modelUsd: costUsd / 0.5, boxes: met ? [sentenceBox('response', ['S0F1'])] : [] },
      { searches: Array.from({ length: wasted }, () => search('compared', [])) },
    ),
    needs: [
      { id: 'record', met, factIds: [], why: '' },
      { id: 'response', met, factIds: [], why: '' },
    ],
    items: [{ label: 'Box 1 sentence 1', text: 't', supported: true, problem: '' }],
    notes: [{ mode: 'model', box: 0, place: 'P1', adds: met, why: '' }],
  })

  it('means each measure over the runs, with its spread, and holds it against its bar', () => {
    const score = scoreContext(
      [run(1, true, 0, 0.02), run(2, false, 2, 0.04), run(1, true, 1, 0.02)].map((r, i) => ({ ...r, slug: i === 2 ? 'story-b' : r.slug })),
    )
    expect(score.runs.map(r => r.run)).toEqual([1, 2])
    expect(score.runs[0]!.stories).toBe(2)
    const bar = (name: string) => score.bars.find(b => b.name === name)!
    // Run 1: 4 of 4 met; run 2: 0 of 2 met: a mean of 50%
    expect(bar('needs').value).toBeCloseTo(0.5)
    expect(bar('needs').met).toBe(false)
    expect(bar('needs').spread?.n).toBe(2)
    // Run 1: 1 wasted over 2 stories; run 2: 2 over 1
    expect(bar('wasted').value).toBeCloseTo((0.5 + 2) / 2)
    expect(bar('wasted').met).toBe(false)
    expect(bar('response').value).toBeCloseTo(0.5)
    expect(bar('boxes').value).toBe(0)
    expect(bar('boxes').met).toBe(true)
    expect(bar('placement').value).toBeCloseTo(0.5)
    expect(bar('cost').value).toBeCloseTo((0.02 + 0.04) / 2)
    expect(bar('cost').met).toBe(true)
    expect(bar('honest-gap').met).toBe(true)
  })

  it('gives no verdict on a measure with nothing to measure', () => {
    const score = scoreContext([])
    expect(score.bars.every(b => b.met === null)).toBe(true)
  })

  it('lists what a reader should look at', () => {
    const r = run(1, false, 1, 0.02)
    r.items = [{ label: 'Box 1 sentence 1', text: 'Wrong.', supported: false, problem: 'not stated' }]
    const score = scoreContext([r])
    expect(score.listed.unsupported).toEqual([{ slug: 'story-a', run: 1, label: 'Box 1 sentence 1', text: 'Wrong.', problem: 'not stated' }])
    expect(score.listed.unmet.map(u => u.need)).toEqual(['record', 'response'])
    expect(score.listed.wasted).toEqual([{ slug: 'story-a', run: 1, slot: 'compared', query: 'q compared' }])
  })
})

describe('scoreFields', () => {
  const label = (key: string, run: number, extra: Partial<FieldLabel> = {}): FieldLabel => ({
    key,
    run,
    verdict: 'supported',
    right: { value: true, unit: true, counted: true, place: true, asOf: true, credited: true },
    invented: false,
    problem: '',
    ...extra,
  })

  it('shares the facts with every field right, per field the wrong ones, and invented numbers the check passed', () => {
    const s = scoreFields([
      label('a', 1),
      label('b', 1, { right: { value: true, unit: false, counted: true, place: true, asOf: false, credited: true } }),
      label('c', 2, { invented: true, right: { value: false, unit: true, counted: true, place: true, asOf: true, credited: true } }),
      label('d', 2, { invented: true, verdict: 'rejected' }),
    ])
    expect(s.labeled).toBe(4)
    expect(s.share).toBeCloseTo(0.5)
    expect(s.wrong).toMatchObject({ unit: 1, asOf: 1, value: 1 })
    expect(s.inventedPassed).toBe(1)
    expect(s.perRun).toEqual([0.5, 0.5])
    expect(s.met).toBe(false)
  })

  it('gives no verdict without labels', () => {
    expect(scoreFields([]).met).toBeNull()
  })
})
