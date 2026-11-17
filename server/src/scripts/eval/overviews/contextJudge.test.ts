import { describe, it, expect } from 'vitest'
import { contextFact, contextInput, contextResult, gapKey, sentenceBox } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { figureFacts, judgeContext, keptItems, notesToJudge, plannedJudgeCalls, type JudgedRun } from './contextJudge.js'

const run = (extra: Partial<JudgedRun> = {}): JudgedRun => ({
  slug: 'story-a',
  run: 1,
  key: gapKey(),
  input: contextInput(),
  result: contextResult({
    facts: [
      contextFact('S0F1', { source: { ...contextFact('S0F1').source, url: 'https://example.com/S0' } }),
      contextFact('S3F1', { origin: 'search', value: null }),
    ],
    boxes: [sentenceBox('compared', ['S0F1'], { place: 'P1' }), sentenceBox('response', [], { sentences: [], gap: true })],
  }),
  ...extra,
})

/** Answers every judge: the first need met, every box item unsupported, every note adding, every field right. */
function answers(schemaName: string, prompt: string): unknown {
  const numbers = (tag: string) => [...prompt.matchAll(new RegExp(`<${tag} number="(\\d+)"`, 'g'))].map(m => Number(m[1]))
  if (schemaName.startsWith('overview-context-needs')) {
    const ids = [...prompt.matchAll(/<NEED id="([^"]+)"/g)].map(m => m[1]!)
    return { needs: [{ id: ids[0], met: true, factIds: ['S0F1'], why: 'Box 1 says it' }] }
  }
  if (schemaName.startsWith('overview-box-support'))
    return { items: numbers('ITEM').map(number => ({ number, supported: false, problem: 'not stated', key: false, copiedSentence: '', followsSource: '' })) }
  if (schemaName.startsWith('overview-context-placement')) return { notes: numbers('NOTE').map(number => ({ number, adds: true, why: 'adds a comparison' })) }
  if (schemaName.startsWith('overview-context-fields'))
    return {
      facts: numbers('FACT').map(number => ({
        number,
        value: true,
        unit: true,
        counted: true,
        place: true,
        asOf: true,
        credited: false,
        invented: false,
        problem: 'credit',
      })),
    }
  return null
}

describe('keptItems', () => {
  it("is production's box check items of the kept cards, the honest gap having none", () => {
    expect(keptItems(run()).map(i => [i.checked.item.label, i.checked.item.text, i.checked.item.factIds])).toEqual([
      ['Box 1 sentence 1', 'A sentence.', ['S0F1']],
    ])
  })
})

describe('notesToJudge', () => {
  it('takes the notes beside the text in model and random mode, each spot once, never the section', () => {
    const r = run()
    r.input.layout.points[0]!.sourceUrls = []
    const notes = notesToJudge(r)
    expect(notes.map(n => [n.modes, n.box, n.place])).toEqual([[['model', 'random'], 0, 'P1']])
  })

  it('judges a box placed apart by the two modes once per place', () => {
    const r = run()
    r.result.boxes[0]!.place = 'W1'
    r.input.layout.points[0]!.sourceUrls = []
    expect(notesToJudge(r).map(n => [n.modes, n.place])).toEqual([
      [['model'], 'W1'],
      [['random'], 'P1'],
    ])
  })
})

describe('figureFacts', () => {
  it("takes each run's own figure facts, spread over the runs, at most the cap", () => {
    const a = run()
    const b = run({ slug: 'story-b', result: contextResult({ facts: [contextFact('S0F1'), contextFact('S0F2'), contextFact('S9F1', { reusedFromId: 'x' })] }) })
    expect(figureFacts([a, b], 10).map(f => f.key)).toEqual(['story-a#1:S0F1', 'story-b#1:S0F1', 'story-b#1:S0F2'])
    expect(figureFacts([a, b], 2).map(f => f.key)).toEqual(['story-a#1:S0F1', 'story-b#1:S0F1'])
  })
})

describe('judgeContext', () => {
  it('asks each judge on the strong arm and reads its verdicts into the story runs and field labels', async () => {
    const ctx = fakeEvalContext(answers)
    const r = run()
    r.input.layout.points[0]!.sourceUrls = []
    const { stories, fields } = await judgeContext(ctx, [r])
    expect(ctx.calls.every(c => c.arm.model === 'gpt-6.1-sol' && c.arm.effort === 'high')).toBe(true)
    const [s] = stories
    // The open needs only: the one the story states is not asked
    const needsPrompt = ctx.calls.find(c => c.schemaName.startsWith('overview-context-needs'))!.prompt
    expect(needsPrompt).not.toContain('id="stated"')
    expect(s!.needs).toEqual([
      { id: 'record', met: true, factIds: ['S0F1'], why: 'Box 1 says it' },
      { id: 'term', met: false, factIds: [], why: 'no verdict' },
      { id: 'response', met: false, factIds: [], why: 'no verdict' },
    ])
    expect(s!.items).toEqual([{ label: 'Box 1 sentence 1', text: 'A sentence.', supported: false, problem: 'not stated' }])
    expect(s!.notes).toEqual([
      { mode: 'model', box: 0, place: 'P1', adds: true, why: 'adds a comparison' },
      { mode: 'random', box: 0, place: 'P1', adds: true, why: 'adds a comparison' },
    ])
    expect(fields).toEqual([
      {
        key: 'story-a#1:S0F1',
        run: 1,
        verdict: 'supported',
        right: { value: true, unit: true, counted: true, place: true, asOf: true, credited: false },
        invented: false,
        problem: 'credit',
      },
    ])
  })

  it('asks nothing of a run with no cards: its open needs are unmet', async () => {
    const ctx = fakeEvalContext(answers)
    const { stories } = await judgeContext(ctx, [run({ result: contextResult() })])
    expect(ctx.calls).toEqual([])
    expect(stories[0]!.needs?.every(n => !n.met)).toBe(true)
    expect(stories[0]!.items).toEqual([])
    expect(stories[0]!.notes).toEqual([])
  })

  it('leaves the verdicts of a failed call empty', async () => {
    const ctx = fakeEvalContext(() => null)
    const { stories, fields } = await judgeContext(ctx, [run()])
    expect(stories[0]!.items?.map(i => i.supported)).toEqual([null])
    expect(stories[0]!.notes?.map(n => n.adds)).toEqual([null, null])
    expect(fields).toEqual([])
  })

  it('plans exactly the calls it makes', async () => {
    const runs = [run(), run({ slug: 'story-b' }), run({ run: 2, result: contextResult() })]
    const ctx = fakeEvalContext(answers)
    await judgeContext(ctx, runs)
    const key = (c: { schemaName: string; prompt: string }) => `${c.schemaName}\n${c.prompt}`
    expect(plannedJudgeCalls(runs).map(key).sort()).toEqual(ctx.calls.map(key).sort())
  })
})
