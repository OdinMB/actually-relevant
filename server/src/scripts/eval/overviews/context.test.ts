import { describe, it, expect } from 'vitest'
import type { PassResult } from '../../../services/researchPass.js'
import { gapKey } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { passInput, researchStory } from '../../../test/passFixtures.js'
import type { TavilyResponse, TavilySearch } from '../research/tavily.js'
import { cardsResult, chooseKeys, FIRST_PASS_RESERVE_USD, JUDGE_DESK_USD_PER_RUN, runContextStep, runPipeline, type ContextStepOptions } from './context.js'
import { halfOf } from './contextScore.js'
import type { GapKeyFile } from './keyFiles.js'

const NONE = { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null }
const FIELDS = {
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact',
  provisional: false,
  counted: '',
  place: '',
  asOf: '',
  credited: '',
  creditedKind: 'none',
  validity: 'fixed',
}

const supportedItems = (prompt: string) => ({
  items: [...prompt.matchAll(/<ITEM number="(\d+)"/g)].map(m => ({
    number: Number(m[1]),
    supported: true,
    problem: '',
    key: false,
    copiedSentence: '',
    followsSource: '',
  })),
})

/**
 * Answers a first pass by schema name: research finds the original's fact and an unusable cluster
 * member (so it falls back, with no article), then the card steps: the two response searches, one
 * fact from each source, a response card citing one, every check supported.
 */
function pipelineAnswers(schemaName: string, prompt: string): unknown {
  const research = /^research-([a-z-]+)#/.exec(schemaName)?.[1]
  if (research === 'queries') return { queries: [{ query: 'Sumatra peat fires', language: 'en' }] }
  // A pass's extraction asks for the structured fields too, under its own name; this fake gives none
  if (research === 'extract' || research === 'extract-structured') {
    const member = prompt.includes('member.example')
    return {
      usable: !member,
      relation: 'same-development',
      kind: 'news-report',
      outlet: '',
      country: 'Indonesia',
      facts: member
        ? []
        : [{ statement: 'Fires burned 2.88 million hectares.', supportingSentence: 'Fires burned 2.88 million hectares.', measures: 'area burned' }],
      voices: [],
    }
  }
  const step = /^overview-context-([a-z-]+)#/.exec(schemaName)?.[1]
  switch (step) {
    case 'structure':
      return { facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({ id: m[1], ...FIELDS })) }
    case 'gap-list':
      return {
        slots: [{ slot: 'response', needed: true, covered: 'no' }],
        responseInStory: '',
        responseSearches: { action: 'peat fire moratorium', elsewhere: 'peat fire prevention that worked' },
        searches: [],
      }
    case 'extract':
      return {
        usable: true,
        kind: 'official-body',
        outlet: 'Agency',
        facts: [
          { statement: 'A moratorium cut fires by half.', supportingSentence: 'A moratorium has cut fires by half since 2016.', slot: 'response', ...FIELDS },
        ],
      }
    case 'fact-check':
    case 'box-check':
      return supportedItems(prompt)
    case 'write':
      return {
        boxes: [
          {
            slot: 'response',
            heading: "What's being done",
            teaser: 'A moratorium since 2016',
            place: 'P1',
            sentences: [{ text: 'A drainage moratorium has halved fires since 2016.', factIds: ['S1F1'] }],
            visual: NONE,
          },
        ],
      }
    default:
      return judgeAnswers(schemaName, prompt)
  }
}

/** The strong judge: every need met, every item supported, every note adding, every field right. */
function judgeAnswers(schemaName: string, prompt: string): unknown {
  const numbers = (tag: string) => [...prompt.matchAll(new RegExp(`<${tag} number="(\\d+)"`, 'g'))].map(m => Number(m[1]))
  if (schemaName.startsWith('overview-context-needs'))
    return { needs: [...prompt.matchAll(/<NEED id="([^"]+)"/g)].map(m => ({ id: m[1], met: true, factIds: ['S1F1'], why: 'the card says it' })) }
  if (schemaName.startsWith('overview-box-support')) return supportedItems(prompt)
  if (schemaName.startsWith('overview-context-placement')) return { notes: numbers('NOTE').map(number => ({ number, adds: true, why: 'adds' })) }
  return null
}

/** Research's coverage searches find nothing; each gap search finds three reports. */
function fakeTavily(dates: (string | null)[] = ['2026-11-10', null, '2026-11-20']) {
  const requests: TavilySearch[] = []
  return {
    requests,
    async search(request: TavilySearch): Promise<TavilyResponse> {
      requests.push(request)
      if (request.topic !== 'general') return { results: [], credits: 2, cached: false }
      return {
        results: dates.map((d, i) => ({
          url: `https://agency-${requests.length}-${i}.example/report`,
          title: 'Report',
          content: 'A moratorium has cut fires by half since 2016. More text follows here.',
          rawContent: null,
          score: 1,
          publishedDate: d,
          favicon: null,
        })),
        credits: 1,
        cached: requests.length > 1,
      }
    },
  }
}

const story = (slug: string) => ({ slug, key: gapKey({ slug }), input: passInput(researchStory({ id: slug })) })

describe('runPipeline', () => {
  it("runs production's first pass on every story, each repeat after the last, logging each gap search", async () => {
    const ctx = fakeEvalContext(pipelineAnswers, { costUsd: 0.001 })
    const tavily = fakeTavily()
    const done: string[] = []
    const out = await runPipeline([story('a'), story('b')], {
      ctx,
      tavily,
      relevanceMin: 5,
      repeat: 2,
      concurrency: 2,
      budgetUsd: 5,
      spentUsd: () => 0,
      onDone: r => done.push(`${r.slug}#${r.run}`),
    })
    expect(out.runs.map(r => `${r.slug}#${r.run}`)).toEqual(['a#1', 'b#1', 'a#2', 'b#2'])
    expect(done.sort()).toEqual(['a#1', 'a#2', 'b#1', 'b#2'])
    const [first] = out.runs
    expect(first!.result).toMatchObject({ status: 'completed', outcome: 'built' })
    expect(first!.result.record.optOutChecked).toBe(false)
    expect(first!.result.boxes.map(b => b.type)).toEqual(['response'])
    // The cards' facts as context reads them: the original's and the gap searches'
    expect(first!.result.facts.map(f => f.ref)).toContain('S0F1')
    expect(first!.result.facts.find(f => f.ref === 'S1F1')).toMatchObject({ origin: 'search', verdict: 'supported', slot: 'response' })
    // The whole pass's cost: research's calls and the card steps'
    expect(first!.result.modelUsd).toBeGreaterThan(first!.result.record.calls.reduce((sum, c) => sum + c.costUsd, 0))
    // No article kept, so the cards were placed on the story's own text
    expect(first!.input).toMatchObject({ storyId: 'a', title: 'Peat fires return to Sumatra', storyDay: '2026-11-14' })
    expect(out.searches.map(s => [s.slug, s.run, s.endDate])).toEqual(
      expect.arrayContaining([
        ['a', 1, '2026-11-14'],
        ['b', 2, '2026-11-14'],
      ]),
    )
    // Research's coverage window ends on the story's day, as the gap searches do
    expect(tavily.requests.filter(r => r.topic !== 'general').every(r => r.endDate === '2026-11-14')).toBe(true)
    expect(ctx.calls.some(c => c.schemaName.startsWith('research-queries#') && c.schemaName.endsWith('~run2'))).toBe(true)
    expect(out.skipped).toEqual([])
  })

  it('starts no story the budget cannot cover', async () => {
    const out = await runPipeline([story('a')], {
      ctx: fakeEvalContext(pipelineAnswers),
      tavily: fakeTavily(),
      relevanceMin: 5,
      repeat: 1,
      concurrency: 1,
      budgetUsd: FIRST_PASS_RESERVE_USD / 2,
      spentUsd: () => 0,
    })
    expect(out.runs).toEqual([])
    expect(out.skipped.map(s => s.storyId)).toEqual(['a#1'])
  })
})

describe('cardsResult', () => {
  const pass = (over: Partial<PassResult> & { cards?: PassResult['record']['cards'] }): PassResult =>
    ({
      status: 'completed',
      outcome: 'written',
      pool: { sources: [], facts: [], searches: [], dropped: [] },
      boxes: [],
      writer: null,
      credits: 3,
      modelUsd: 0.05,
      error: null,
      transient: false,
      ...over,
      record: { context: { calls: [] }, cards: over.cards ?? 'none', cardsError: 'cards: write failed' },
    }) as unknown as PassResult

  it('reads a card failure as a failed run, a budget stop as a skipped one, and no card kept as none kept', () => {
    expect(cardsResult(pass({ cards: 'failed' }))).toMatchObject({ status: 'failed', outcome: 'technical', error: 'cards: write failed' })
    expect(cardsResult(pass({ outcome: 'budget' }))).toMatchObject({ status: 'skipped', outcome: 'technical' })
    expect(cardsResult(pass({ status: 'failed', outcome: 'technical', error: 'facts-check: x' }))).toMatchObject({ status: 'failed', error: 'facts-check: x' })
    expect(cardsResult(pass({}))).toMatchObject({ status: 'completed', outcome: 'none-kept', credits: 3, modelUsd: 0.05 })
  })
})

describe('chooseKeys', () => {
  const file = (slug: string, errors: string[] = []): GapKeyFile => ({ file: `${slug}.json`, key: gapKey({ slug }), errors })
  const slugs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  it('takes the keys without errors in the half, in file order, the first --limit', () => {
    const files = [...slugs.map(s => file(s)), file('broken', ['x']), { file: 'bad.json', key: null, errors: ['not valid JSON'] }]
    const judge = slugs.filter(s => halfOf(s) === 'judge')
    expect(chooseKeys(files, 'judge').keys.map(k => k.slug)).toEqual(judge)
    expect(chooseKeys(files, 'all', 3).keys.map(k => k.slug)).toEqual(['a', 'b', 'c'])
    expect(chooseKeys(files, 'all').left).toEqual([
      { file: 'broken.json', reason: '1 format errors: fix the key' },
      { file: 'bad.json', reason: '1 format errors: fix the key' },
    ])
  })
})

describe('runContextStep', () => {
  const options = (extra: Partial<ContextStepOptions> = {}): ContextStepOptions => ({
    ctx: fakeEvalContext(pipelineAnswers),
    tavily: fakeTavily(),
    relevanceMin: 5,
    files: [
      { file: 'story-a.json', key: gapKey({ slug: 'story-a' }), errors: [] },
      { file: 'gone.json', key: gapKey({ slug: 'gone' }), errors: [] },
    ],
    half: 'all',
    repeat: 1,
    concurrency: 2,
    budgetUsd: 5,
    inputs: async slugs => new Map(slugs.map(s => [s, s === 'gone' ? null : passInput(researchStory({ id: s }))])),
    canCall: true,
    dryRun: false,
    ...extra,
  })

  it('runs the stories with an input, judges them and scores the bars', async () => {
    const { report, runs } = await runContextStep(options())
    expect(report).toMatchObject({ keys: 2, stories: 1, deskUsd: null, skipped: [] })
    expect(report.left).toEqual([{ file: 'gone.json', reason: expect.stringMatching(/no input/) }])
    expect(runs.map(r => r.slug)).toEqual(['story-a'])
    expect(report.judge?.stopped).toBeNull()
    const bar = (name: string) => report.score.bars.find(b => b.name === name)
    expect(bar('needs')?.value).toBe(1)
    expect(bar('response')?.value).toBe(1)
    expect(bar('boxes')?.met).toBe(true)
    expect(report.dates).toEqual({ searches: 2, results: 6, undated: 2, afterStory: 2 })
  })

  it('scores without verdicts when the judge may not call', async () => {
    const { report } = await runContextStep(options({ canCall: false, ctx: fakeEvalContext(pipelineAnswers, { costUsd: 0 }) }))
    expect(report.judge?.stopped).toMatch(/OPENAI_API_KEY/)
    expect(report.score.bars.find(b => b.name === 'boxes')?.met).toBeNull()
    expect(report.fields.labeled).toBe(0)
  })

  it('only estimates on a dry run, and loads no input without a key to run', async () => {
    const ctx = fakeEvalContext(() => {
      throw new Error('no call on a dry run')
    })
    const dry = await runContextStep(options({ ctx, dryRun: true, repeat: 3 }))
    expect(dry.report.deskUsd).toBeCloseTo(3 * (FIRST_PASS_RESERVE_USD + JUDGE_DESK_USD_PER_RUN))
    expect(dry.runs).toEqual([])
    const none = await runContextStep(options({ files: [], inputs: () => Promise.reject(new Error('no database')) }))
    expect(none.report.stories).toBe(0)
  })
})
