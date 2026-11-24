import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
import type { FigureItem } from '../prompts/storyContext.js'
import type { FigureAnswer, FigureCheck } from '../schemas/storyContext.js'
import { contextFact } from '../test/contextFixtures.js'
import type { ContextFactData } from './storyContextChecks.js'
import { judgeFigures } from './storyContextFigures.js'

/** A fake figure check: the figures of each call kept, every one answered as `answerOf` says (`null` leaves it out). */
function fakeAsk(answerOf: (item: FigureItem) => FigureAnswer | null = () => 'given') {
  const calls: FigureItem[][] = []
  const ask = async (figures: FigureItem[]): Promise<FigureCheck> => {
    calls.push(figures)
    return { figures: figures.flatMap(f => (answerOf(f) === null ? [] : [{ id: f.id, inSource: answerOf(f)! }])) }
  }
  return { ask, calls }
}

const figureless = (ref: string, over: Partial<ContextFactData> = {}) => contextFact(ref, { value: null, unit: '', counted: '', ...over })

describe('judgeFigures', () => {
  it('makes no call when no fact carries a figure, and returns the facts as they were', async () => {
    const facts = [figureless('S1F1'), figureless('S1F2')]
    const { ask, calls } = fakeAsk()
    expect(await judgeFigures(facts, ask)).toEqual({ facts, removed: [] })
    expect(calls).toEqual([])
  })

  it('asks about the facts with a figure only, a batch a call, one call after another in fact order', async () => {
    const size = config.storyContext.checkBatchSize
    // Two full batches of figures and three more, a figureless fact before every seventh
    const facts = Array.from({ length: 2 * size + 3 }, (_, i) =>
      i % 7 === 0 ? [figureless(`S2F${i}`), contextFact(`S1F${i}`)] : [contextFact(`S1F${i}`)],
    ).flat()
    const order: string[] = []
    const ask = async (figures: FigureItem[]): Promise<FigureCheck> => {
      order.push(`start ${figures[0]!.id}`)
      await new Promise(resolve => setTimeout(resolve, 1))
      order.push(`end ${figures[0]!.id}`)
      return { figures: figures.map(f => ({ id: f.id, inSource: 'given' as const })) }
    }
    const asked: string[][] = []
    await judgeFigures(facts, async figures => (asked.push(figures.map(f => f.id)), ask(figures)))

    const withFigure = facts.filter(f => f.value !== null).map(f => f.ref)
    expect(asked.flat()).toEqual(withFigure)
    expect(asked.map(a => a.length)).toEqual([size, size, 3])
    // Each call ends before the next starts
    expect(order).toEqual(asked.flatMap(a => [`start ${a[0]}`, `end ${a[0]}`]))
  })

  it('shows each figure as spelled, what it counts (else its unit) and its source’s words, the passage before the sentence; never the statement', async () => {
    const { ask, calls } = fakeAsk()
    await judgeFigures(
      [
        contextFact('S1F1', {
          value: 2_880_000,
          unit: 'hectares',
          approx: 'about',
          counted: 'area burned in Indonesia',
          supportingSentence: 'Fires burned 2.88m ha.',
        }),
        contextFact('S2F1', { origin: 'search', passage: 'Before. Fires burned 2.88m ha. After.', supportingSentence: 'Fires burned 2.88m ha.' }),
        contextFact('S2F2', { value: 12, unit: 'hectares', counted: '  ' }),
      ],
      ask,
    )
    expect(calls).toEqual([
      [
        { id: 'S1F1', number: 'about 2.88 million hectares', counts: 'area burned in Indonesia', source: 'Fires burned 2.88m ha.' },
        { id: 'S2F1', number: '100 people', counts: 'people evacuated', source: 'Before. Fires burned 2.88m ha. After.' },
        { id: 'S2F2', number: '12 hectares', counts: 'hectares', source: 'Sentence of S2F2.' },
      ],
    ])
    expect(JSON.stringify(calls)).not.toContain('Statement of')
  })

  it('keeps a figure its source gives, and removes one for every other answer, recording the answer', async () => {
    const answers: Record<string, FigureAnswer> = { S1F1: 'given', S1F2: 'computed', S1F3: 'other-thing', S1F4: 'not-stated' }
    const facts = Object.keys(answers).map(ref => contextFact(ref, { counted: `thing of ${ref}` }))
    const { ask } = fakeAsk(item => answers[item.id]!)
    const out = await judgeFigures(facts, ask)

    expect(out.facts.map(f => [f.ref, f.value])).toEqual([
      ['S1F1', 100],
      ['S1F2', null],
      ['S1F3', null],
      ['S1F4', null],
    ])
    expect(out.removed).toEqual([
      { ref: 'S1F2', figure: '100 people', counted: 'thing of S1F2', answer: 'computed' },
      { ref: 'S1F3', figure: '100 people', counted: 'thing of S1F3', answer: 'other-thing' },
      { ref: 'S1F4', figure: '100 people', counted: 'thing of S1F4', answer: 'not-stated' },
    ])
  })

  it('removes a figure the answer leaves out, as having no answer', async () => {
    const { ask } = fakeAsk(item => (item.id === 'S1F2' ? null : 'given'))
    const out = await judgeFigures([contextFact('S1F1'), contextFact('S1F2', { unit: 'tents', counted: '' })], ask)
    expect(out.facts.map(f => f.value)).toEqual([100, null])
    expect(out.removed).toEqual([{ ref: 'S1F2', figure: '100 tents', counted: 'tents', answer: 'no-answer' }])
  })

  it('ignores an answer for an id it did not ask about, a figureless fact’s among them', async () => {
    const facts = [contextFact('S1F1'), figureless('S1F2')]
    const out = await judgeFigures(facts, async () => ({
      figures: [
        { id: 'S1F1', inSource: 'given' },
        { id: 'S1F2', inSource: 'not-stated' },
        { id: 'S9F9', inSource: 'computed' },
      ],
    }))
    expect(out).toEqual({ facts, removed: [] })
  })

  it('takes the first answer for an id', async () => {
    const twice = (first: FigureAnswer, second: FigureAnswer) =>
      judgeFigures([contextFact('S1F1')], async () => ({
        figures: [
          { id: 'S1F1', inSource: first },
          { id: 'S1F1', inSource: second },
        ],
      }))
    expect((await twice('not-stated', 'given')).removed.map(r => r.answer)).toEqual(['not-stated'])
    expect((await twice('given', 'computed')).removed).toEqual([])
  })

  it('takes only the figure from a fact it removes it from, and returns every fact in its order', async () => {
    const kept = figureless('S1F1', { statement: 'A ban is planned.', provisional: true })
    const fact = contextFact('S1F2', {
      value: 5000,
      valueHigh: 5400,
      unit: 'people',
      approx: 'about',
      provisional: true,
      counted: 'people killed',
      place: 'Riau',
      asOf: '2026-11',
      credited: 'the agency',
      creditedKind: 'official',
      validity: 'fast',
    })
    const out = await judgeFigures([kept, fact], fakeAsk(() => 'not-stated').ask)
    expect(out.facts).toEqual([kept, { ...fact, value: null, valueHigh: null, unit: '', counted: '', approx: 'exact' }])
    expect(out.removed).toEqual([{ ref: 'S1F2', figure: 'about 5,000 to 5,400 people', counted: 'people killed', answer: 'not-stated' }])
  })

  it('rejects when a call throws, whatever earlier calls answered', async () => {
    const size = config.storyContext.checkBatchSize
    const facts = Array.from({ length: size + 1 }, (_, i) => contextFact(`S1F${i}`))
    let n = 0
    const failing = async (figures: FigureItem[]): Promise<FigureCheck> => {
      if (++n === 2) throw new Error('figure-check: error')
      return { figures: figures.map(f => ({ id: f.id, inSource: 'not-stated' as const })) }
    }
    await expect(judgeFigures(facts, failing)).rejects.toThrow('figure-check: error')
  })
})
