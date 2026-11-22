import { describe, expect, it } from 'vitest'
import { buildResearchedStory } from '../../../services/researchedStory.js'
import { researchView, type Article, type ArticleVersionData, type PoolFact, type PoolSource } from '../../../services/researchPool.js'
import { fakeEvalContext } from '../../../test/fakeEvalContext.js'
import { LABEL_DEVELOPMENTS } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { runUpdateStep, type UpdateStepOptions } from './update.js'
import type { UpdateStory } from './updateFixtures.js'

const source: PoolSource = {
  id: 'src-S1',
  ref: 'S1',
  origin: 'search',
  earlierStoryId: null,
  url: 'https://news.example/S1',
  outlet: 'News',
  title: 'Floods',
  date: '2026-10-01',
  kind: 'news-report',
  country: '',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: false,
  firstPassId: null,
}

const fact = (ref: string, statement: string): PoolFact => ({
  id: `fact-${ref}`,
  ref,
  sourceRef: 'S1',
  reusedFromId: null,
  supportingSentence: statement,
  passage: null,
  supportFound: true,
  statement,
  measures: ref === 'S1F2' ? 'people displaced' : '',
  slot: null,
  structured: null,
  extractedBy: { model: 'm', promptVersion: 'legacy' },
  verdict: 'unjudged',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
})

const pool = { sources: [source], facts: [fact('S1F1', 'Floods hit the valley.'), fact('S1F2', 'Floods displaced 4,000 people.')] }

const article: Article = {
  titleLabel: 'Floods',
  title: 'Floods hit the valley',
  story: [
    { text: 'Floods hit the valley.', factIds: ['S1F1'] },
    { text: 'Floods displaced 4,000 people.', factIds: ['S1F2'] },
  ],
  whyThisMatters: [{ text: 'The valley is home to many.', factIds: ['S1F1'] }],
  caveats: [{ text: 'Counts are early.', factIds: [] }],
  summary: 'Floods hit the valley.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Floods in the valley.',
}

const version: ArticleVersionData = {
  id: null,
  number: 1,
  kind: 'legacy',
  status: 'current',
  passId: null,
  title: article.title,
  titleLabel: article.titleLabel,
  summary: article.summary,
  marketingBlurb: article.marketingBlurb,
  quote: null,
  quoteAttribution: null,
  relevanceReasons: null,
  antifactors: null,
  emotionTag: null,
  research: buildResearchedStory({ draft: article, ...researchView(pool) }),
  article: null,
  changes: [],
  note: null,
}

const keyFile: KeyFile = {
  file: 'floods.json',
  errors: [],
  key: {
    schemaVersion: 1,
    id: 'floods',
    title: 'Valley floods',
    charter: { in: 'The valley floods.', out: [], endEvent: 'Waters recede.' },
    figures: [],
    entries: [
      {
        slug: 'floods-a',
        date: '2026-10-01',
        title: 'Floods hit the valley',
        join: 'must',
        role: 'routine',
        kind: null,
        values: [],
        statuses: [],
        why: 'belongs',
      },
    ],
    nearMisses: [{ slug: 'drought-north', date: '2026-10-02', title: 'Drought hits the north', why: 'Other disaster.' }],
    notes: '',
  },
}

const story: UpdateStory = { slug: 'floods-a', storyDay: '2026-10-01', version, pool }

const items = (prompt: string) => [...prompt.matchAll(/<ITEM number="(\d+)" label="([^"]+)">/g)].map(m => ({ number: Number(m[1]), label: m[2]! }))

/** The judge flags the planted correction alone; the rewrite, checks, note and note judge all pass. */
function answer(schemaName: string, prompt: string): unknown {
  if (schemaName.startsWith('pass-judge')) {
    if (prompt.includes('Drought')) return { sections: [], contradicted: [] }
    return {
      sections: [{ label: 'Story paragraph 2', verdict: 'wrong', factIds: ['S2F1'], reason: 'The wire puts it at 6,000.' }],
      contradicted: [{ factId: 'S1F2', byFactIds: ['S2F1'], reason: 'Six thousand, not four.' }],
    }
  }
  if (schemaName.startsWith('pass-update')) {
    return {
      items: [{ label: 'Story paragraph 2', text: 'The floods displaced 6,000 people.', factIds: ['S2F1'] }],
      quote: '',
      quoteAttribution: '',
      quoteSourceId: '',
    }
  }
  if (schemaName.startsWith('research-fact-check')) {
    return { items: items(prompt).map(i => ({ number: i.number, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })) }
  }
  if (schemaName.startsWith('pass-note')) return { text: 'A wire report put the number displaced at 6,000 rather than 4,000.', factIds: ['S2F1'] }
  if (schemaName.startsWith('overview-update-note')) return { accurate: true, complete: true, problem: '' }
  return null
}

const options = (over: Partial<UpdateStepOptions> = {}): UpdateStepOptions => ({
  ctx: fakeEvalContext(answer),
  files: [keyFile],
  half: 'all',
  stories: async slugs => new Map(slugs.map(s => [s, s === 'floods-a' ? story : null])),
  canCall: true,
  dryRun: false,
  repeat: 1,
  concurrency: 2,
  budgetUsd: 5,
  ...over,
})

describe('runUpdateStep', () => {
  it('estimates on a dry run without a call', async () => {
    const ctx = fakeEvalContext(answer)
    const { report, runs } = await runUpdateStep(options({ ctx, dryRun: true, repeat: 2 }))
    expect(report).toMatchObject({ keys: 1, stories: 1, cases: { key: 0, 'wrong-number': 1, 'wrong-year': 0, benign: 1 } })
    expect(report.deskUsd).toBeCloseTo(2 * 2 * 0.12)
    expect(runs).toEqual([])
    expect(ctx.calls).toEqual([])
  })

  it('reads no label key: its stories are only there to say what a story is for the linking evals', async () => {
    const [label] = LABEL_DEVELOPMENTS
    const labelFile: KeyFile = {
      file: `${label}.json`,
      errors: [],
      key: { ...keyFile.key!, id: label!, entries: keyFile.key!.entries.map(e => ({ ...e, slug: 'label-a' })) },
    }
    const { report } = await runUpdateStep(options({ files: [keyFile, labelFile], dryRun: true }))
    expect(report).toMatchObject({ keys: 1, stories: 1 })
    expect(report.left.map(l => l.what)).not.toContain('label-a')
  })

  it("runs production's article step on each case and judges each served note", async () => {
    const ctx = fakeEvalContext(answer)
    const { report, runs } = await runUpdateStep(options({ ctx }))
    expect(runs.map(r => [r.fixture.id, r.result.outcome])).toEqual([
      ['floods-a:wrong-number', 'updated'],
      ['floods-a:benign', 'unchanged'],
    ])
    expect(runs[0]!.result.demoted.map(d => d.ref)).toEqual(['S1F2'])
    expect(runs[0]!.note).toEqual({ accurate: true, complete: true, problem: '' })
    expect(ctx.calls.filter(c => c.schemaName.startsWith('overview-update-note'))).toHaveLength(1)
    expect(report.score.bars.filter(b => b.met === false)).toEqual([])
    expect(report.judge).toMatchObject({ stopped: null, estimate: { calls: 1 } })
    // The note judge reads the change, the facts it rests on and the note
    const judged = ctx.calls.find(c => c.schemaName.startsWith('overview-update-note'))!.prompt
    expect(judged).toContain('Floods displaced 4,000 people.')
    expect(judged).toContain('<FACT id="S1F2" outlet="News" date="2026-10-01" contradicted="true">')
  })

  it('leaves the notes unjudged when the judge cannot call, and runs k ≥ 2 under their own keys', async () => {
    const ctx = fakeEvalContext(answer)
    const { report, runs } = await runUpdateStep(options({ ctx, canCall: false, repeat: 2 }))
    expect(report.judge?.stopped).toBe('2 uncached calls and OPENAI_API_KEY is missing')
    expect(runs.every(r => r.note === null)).toBe(true)
    expect(ctx.calls.some(c => c.schemaName.startsWith('pass-judge') && c.schemaName.endsWith('~run2'))).toBe(true)
    expect(report.score.runs).toHaveLength(2)
  })
})
