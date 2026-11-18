import { describe, expect, it } from 'vitest'
import { fakeEvalContext } from '../../test/fakeEvalContext.js'
import type { Fixtures, NewsletterItem, PreassessItem } from './fixtures.js'
import { LAYOUT_STEP_DEFS, reclassifyCriteria, scoreReclassify, scoreUplifting, upliftingCases } from './layoutChecks.js'
import type { StepInput } from './recalibrationChecks.js'
import type { CallRecord } from './types.js'

const ISSUES = [
  { slug: 'climate', name: 'Climate', description: '' },
  { slug: 'health', name: 'Health', description: '' },
] as never

const item = (id: string, issueSlug = 'climate', emotion = 'calm'): PreassessItem => ({
  id,
  title: `Title ${id}`,
  content: `Content ${id}`,
  language: 'en',
  han: false,
  status: 'published',
  stored: { issueSlug, rating: 5, emotion },
})

const record = <T>(parsed: T | null, outcome: CallRecord['outcome'] = parsed ? 'ok' : 'parse_failure'): CallRecord<T> => ({
  key: 'k',
  arm: 'gpt-6-luna@low',
  schema: 's',
  outcome,
  parsed,
  content: '',
  finishReason: 'stop',
  usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
  costUsd: 0,
  latencyMs: 0,
  at: '',
})

describe('the reclassification check', () => {
  it('scores each answer against the stored issue and emotion, counting what is left out, unknown or invalid', () => {
    const bs = [[item('a'), item('b', 'health', 'uplifting'), item('c')], [item('d')]]
    const m = scoreReclassify(
      bs,
      [
        record({
          articles: [
            { articleId: 'a', issueSlug: 'climate', emotionTag: 'calm' },
            { articleId: 'a', issueSlug: 'health', emotionTag: 'calm' },
            { articleId: 'b', issueSlug: 'climate', emotionTag: 'uplifting' },
            { articleId: 'x', issueSlug: 'climate', emotionTag: 'calm' },
          ],
        }),
        record(null),
      ],
      ISSUES,
    )
    // c is left out; the failed batch counts as a failure, not as its stories left out
    expect(m).toEqual({ stories: 4, omitted: 1, unknownIds: 1, invalidSlugs: 0, failures: 1, issueAgreement: 0.5, emotionAgreement: 1 })
    const criteria = reclassifyCriteria(m)
    expect(criteria.filter(c => c.required && !c.pass).map(c => c.name)).toEqual([
      'Stories left out of their batch',
      'Unknown article ids returned',
      'Failed calls',
    ])
    // The agreement is reported against phase 1's pre-assessment, never required
    expect(criteria.filter(c => c.name.includes('agreement')).every(c => !c.required)).toBe(true)
  })

  it("runs production's prompt on the pre-assessment batches, the stories last", async () => {
    const fx = { preassess: [item('a'), item('b')], issues: ISSUES } as unknown as Fixtures
    const input = { fx, opts: { limit: undefined } } as unknown as StepInput
    const ctx = fakeEvalContext(() => ({
      articles: [
        { articleId: 'a', issueSlug: 'climate', emotionTag: 'calm' },
        { articleId: 'b', issueSlug: 'climate', emotionTag: 'calm' },
      ],
    }))
    const section = await LAYOUT_STEP_DEFS.reclassify.run(input, ctx, ctx)

    expect(section.criteria.filter(c => c.required).every(c => c.pass)).toBe(true)
    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0]!.schemaName).toMatch(/^reclassify#/)
    const prompt = ctx.calls[0]!.prompt
    expect(prompt.indexOf('Title a')).toBeGreaterThan(prompt.indexOf('climate'))
  })
})

describe('the Actually Uplifting selection check', () => {
  const story = (id: string, emotionTag: string) => ({ id, title: `T${id}`, summary: '', issueName: 'Climate', emotionTag })
  const newsletter = (id: string, stories: ReturnType<typeof story>[]): NewsletterItem => ({
    id,
    title: `Issue ${id}`,
    longlist: stories,
    issueNames: ['Climate'],
    storiesPerIssue: 3,
    storedSelected: [],
  })

  it('cuts a longlist to its uplifting stories when it has more than the issue carries, else keeps it whole', () => {
    const many = Array.from({ length: 4 }, (_, i) => story(`u${i}`, 'uplifting'))
    const cases = upliftingCases([newsletter('n1', [...many, story('c', 'calm')]), newsletter('n2', [story('u', 'uplifting'), story('c', 'calm')])], 3)
    expect(cases.map(c => [c.id, c.upliftingOnly, c.stories.length])).toEqual([
      ['n1', true, 4],
      ['n2', false, 2],
    ])
  })

  it("gates on exactly the issue's count of valid, unique ids", () => {
    const cases = upliftingCases([newsletter('n1', [story('a', 'calm'), story('b', 'calm')]), newsletter('n2', [story('c', 'calm')])])
    const m = scoreUplifting(cases, [record({ selectedIds: ['a', 'b'] }), record({ selectedIds: ['c', 'zz'] })])
    expect(m).toMatchObject({ exactCount: 0.5, invalidIds: 1, declined: 0, failures: 0, picks: [['a', 'b'], ['c']] })
  })
})
