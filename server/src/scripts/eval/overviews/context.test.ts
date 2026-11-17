import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { config } from '../../../config.js'
import { CONTEXT_STEP_TIERS } from '../../../services/storyContextPipeline.js'
import { contextInput, gapKey } from '../../../test/contextFixtures.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import type { TavilyResponse, TavilySearch } from '../research/tavily.js'
import {
  chooseKeys,
  CONTEXT_STEP_ARMS,
  CONTEXT_STORY_RESERVE_USD,
  contextCall,
  evalSearch,
  JUDGE_DESK_USD_PER_RUN,
  runContextStep,
  runPipeline,
  type ContextStepOptions,
} from './context.js'
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

/** Answers production's context steps by schema name: the two response searches, one fact from each source, a response card citing one, every check supported. */
function pipelineAnswers(schemaName: string, prompt: string): unknown {
  const step = /^overview-context-([a-z-]+)#/.exec(schemaName)?.[1]
  const numbers = (tag: string) => [...prompt.matchAll(new RegExp(`<${tag} number="(\\d+)"`, 'g'))].map(m => Number(m[1]))
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
      return { items: numbers('ITEM').map(number => ({ number, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })) }
    case 'write':
      return {
        figures: null,
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
  if (schemaName.startsWith('overview-box-support'))
    return { items: numbers('ITEM').map(number => ({ number, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })) }
  if (schemaName.startsWith('overview-context-placement')) return { notes: numbers('NOTE').map(number => ({ number, adds: true, why: 'adds' })) }
  return null
}

function fakeTavily(dates: (string | null)[] = ['2026-11-10', null, '2026-11-20']) {
  const requests: TavilySearch[] = []
  return {
    requests,
    async search(request: TavilySearch): Promise<TavilyResponse> {
      requests.push(request)
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

describe('contextCall', () => {
  it("holds each step's constant arm at production's default model and effort for the step's tier", () => {
    for (const [step, tier] of Object.entries(CONTEXT_STEP_TIERS)) {
      const production = config.llm.models[tier]
      expect(CONTEXT_STEP_ARMS[step as keyof typeof CONTEXT_STEP_TIERS], step).toEqual({ model: production.name, effort: production.reasoningEffort })
    }
  })

  it("calls each step on its tier's constant arm, under a versioned name that run 2 tags", async () => {
    const ctx = fakeEvalContext(() => ({ facts: [] }))
    expect(CONTEXT_STEP_ARMS.write).toEqual({ model: 'gpt-6-luna', effort: 'medium' })
    expect(
      Object.entries(CONTEXT_STEP_TIERS)
        .filter(([, t]) => t === 'small')
        .every(([s]) => CONTEXT_STEP_ARMS[s as 'structure'].effort === 'low'),
    ).toBe(true)
    const schema = z.object({ facts: z.array(z.string()) })
    const first = await contextCall(ctx, 1)('structure', schema, 'prompt')
    await contextCall(ctx, 2)('structure', schema, 'prompt')
    expect(first).toMatchObject({ parsed: { facts: [] }, outcome: 'ok', model: 'gpt-6-luna' })
    expect(ctx.calls.map(c => c.schemaName)).toEqual([expect.stringMatching(/^overview-context-structure#[0-9a-f]{8}$/), expect.stringMatching(/~run2$/)])
  })

  it('hands a failed call on as a parse failure with no answer', async () => {
    const res = await contextCall(
      fakeEvalContext(() => null),
      1,
    )('gap-list', z.object({}), 'prompt')
    expect(res).toMatchObject({ parsed: null, outcome: 'parse_failure' })
  })
})

describe('evalSearch', () => {
  it("sends production's request, shapes the results as production does, and logs their dates", async () => {
    const tavily = fakeTavily()
    const logged: unknown[] = []
    const answer = await evalSearch(tavily, e => logged.push(e))({ query: 'peat fire moratorium', recent: true, endDate: '2026-11-14' })
    expect(tavily.requests[0]).toMatchObject({
      query: 'peat fire moratorium',
      endDate: '2026-11-14',
      startDate: '2026-10-15',
      topic: 'general',
      depth: config.storyContext.searchDepth,
    })
    expect(answer.cached).toBe(false)
    expect(answer.credits).toBe(1)
    expect(answer.results[0]).toEqual({
      url: 'https://agency-1-0.example/report',
      title: 'Report',
      date: '2026-11-10',
      text: expect.stringContaining('moratorium'),
    })
    expect(logged).toEqual([{ endDate: '2026-11-14', dates: ['2026-11-10', null, '2026-11-20'] }])
  })
})

describe('runPipeline', () => {
  it("runs production's pipeline on every story, each repeat after the last, logging each search", async () => {
    const ctx = fakeEvalContext(pipelineAnswers, { costUsd: 0.001 })
    const done: string[] = []
    const story = (slug: string) => ({ slug, key: gapKey({ slug }), input: contextInput({ storyId: slug }) })
    const out = await runPipeline([story('a'), story('b')], {
      ctx,
      tavily: fakeTavily(),
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
    expect(out.searches.map(s => [s.slug, s.run, s.endDate])).toEqual(
      expect.arrayContaining([
        ['a', 1, '2026-11-14'],
        ['b', 2, '2026-11-14'],
      ]),
    )
    expect(ctx.calls.some(c => c.schemaName.endsWith('~run2'))).toBe(true)
    expect(out.skipped).toEqual([])
  })

  it('starts no story the budget cannot cover', async () => {
    const out = await runPipeline([{ slug: 'a', key: gapKey(), input: contextInput() }], {
      ctx: fakeEvalContext(pipelineAnswers),
      tavily: fakeTavily(),
      repeat: 1,
      concurrency: 1,
      budgetUsd: CONTEXT_STORY_RESERVE_USD / 2,
      spentUsd: () => 0,
    })
    expect(out.runs).toEqual([])
    expect(out.skipped.map(s => s.storyId)).toEqual(['a#1'])
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
    files: [
      { file: 'story-a.json', key: gapKey({ slug: 'story-a' }), errors: [] },
      { file: 'gone.json', key: gapKey({ slug: 'gone' }), errors: [] },
    ],
    half: 'all',
    repeat: 1,
    concurrency: 2,
    budgetUsd: 5,
    inputs: async slugs => new Map(slugs.map(s => [s, s === 'gone' ? null : contextInput({ storyId: s })])),
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
    expect(dry.report.deskUsd).toBeCloseTo(3 * (CONTEXT_STORY_RESERVE_USD + JUDGE_DESK_USD_PER_RUN))
    expect(dry.runs).toEqual([])
    const none = await runContextStep(options({ files: [], inputs: () => Promise.reject(new Error('no database')) }))
    expect(none.report.stories).toBe(0)
  })
})
