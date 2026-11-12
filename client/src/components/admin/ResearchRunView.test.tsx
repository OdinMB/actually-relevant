import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ResearchFact, ResearchResult, ResearchRun, ResearchSource, ResearchVerdict } from '@shared/types'
import { ResearchRunView } from './ResearchRunView'

const fact = (id: string, found = true): ResearchFact => ({ id, statement: `Fact ${id}.`, supportingSentence: `Sentence ${id}.`, measures: '', found })

const source = (over: Partial<ResearchSource>): ResearchSource => ({
  id: 'S0',
  origin: 'original',
  url: 'https://dawn.example/a',
  title: 'Title',
  outlet: 'Dawn',
  date: '2026-11-10',
  favicon: 'https://dawn.example/favicon.ico',
  usedRawContent: false,
  kind: 'news-report',
  country: 'Pakistan',
  relation: 'same-development',
  facts: [fact('S0F1')],
  voices: [],
  ...over,
})

const result = (verdict: ResearchVerdict = { kind: 'keep' }): ResearchResult => ({
  storyId: 'story-1',
  calls: [{ step: 'write', outcome: 'ok', usage: { input: 1000, cached: 0, output: 100, reasoning: 40 }, costUsd: 0.02, model: 'gpt-6-luna' }],
  credits: 4,
  searches: [{ query: 'solar Pakistan', language: 'en', results: 5, credits: 2, cached: false }],
  candidates: 6,
  drops: { date: 2 },
  sources: [
    source({}),
    source({ id: 'S1', origin: 'search', url: 'javascript:alert(1)', outlet: 'Odd Outlet', favicon: 'http://odd.example/f.ico', facts: [fact('S1F1', false)] }),
  ],
  earlier: [{ id: 'E1', storyId: 'old-1', slug: 'old-story', title: 'Earlier story', date: '2026-05-01', relation: 'background', facts: [fact('E1F1')] }],
  draft: {
    titleLabel: 'Solar',
    title: 'Pakistan adds rooftop solar',
    story: [
      {
        sentences: [
          { text: 'Pakistan added solar.', factIds: ['S0F1', 'E1F1'] },
          { text: 'An odd claim.', factIds: ['S1F1'] },
        ],
      },
    ],
    summary: 'A summary.',
    whyThisMatters: [{ text: 'It matters.', factIds: [] }],
    caveats: [{ text: 'A caveat.', factIds: ['S0F1'] }],
    quote: 'We did it.',
    quoteAttribution: 'A minister',
    quoteSourceId: 'S0',
    marketingBlurb: 'A blurb.',
    relevanceCalculation: ['- **Energy access:** 6'],
    rating: 6,
    oldNews: { isOld: false, firstHappened: '2026-11-01' },
    contradicted: { isContradicted: false, factIds: [] },
  },
  rewritten: false,
  problems: [],
  support: { facts: 3, found: 2 },
  optOutChecked: false,
  verdict,
  models: {
    confirm: 'gpt-6-luna',
    queries: 'gpt-6-luna',
    extract: 'gpt-6-luna',
    earlier: 'gpt-6-luna',
    write: 'gpt-6-luna',
    'fact-check': 'gpt-6-luna',
    rewrite: 'gpt-6-luna',
  },
  prices: { models: {}, cacheWriteFactor: 1.25, tavilyUsdPerCredit: 0.008 },
})

const line = (usd: number) => ({ calls: 1, usage: { input: 1000, cached: 0, output: 100, reasoning: 40 }, usd, models: ['gpt-6-luna'] })

const run = (over: Partial<ResearchRun> = {}): ResearchRun => ({
  id: 'run-1',
  storyId: 'story-1',
  status: 'completed',
  trigger: 'editor',
  verdict: 'keep',
  costUsd: 0.052,
  tavilyCredits: 4,
  error: null,
  startedAt: '2026-11-12T10:00:00Z',
  finishedAt: '2026-11-12T10:01:00Z',
  result: result(),
  cost: { steps: [{ step: 'write', ...line(0.02) }], model: line(0.02), tavily: { credits: 4, usd: 0.032 }, totalUsd: 0.052 },
  ...over,
})

describe('ResearchRunView', () => {
  it.each<[string, ResearchVerdict, RegExp]>([
    ['keep', { kind: 'keep' }, /^Keep: the research supports/],
    ['research-rating', { kind: 'research-rating', rating: 3 }, /research rates the story 3/],
    ['stale', { kind: 'stale', firstHappened: '2025-01-02' }, /first happened on 2025-01-02/],
    ['contradicted', { kind: 'contradicted', factIds: ['S1F1'] }, /Contradicted: S1F1 contradict/],
    ['fallback', { kind: 'fallback', reason: 'no usable source' }, /Today's format: no usable source/],
  ])('shows the %s verdict with its reason or rating', (_kind, verdict, text) => {
    render(<ResearchRunView run={run({ result: result(verdict) })} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('names each citation chip after its source, and our earlier stories as Actually Relevant', () => {
    render(<ResearchRunView run={run()} />)
    expect(screen.getAllByRole('link', { name: 'Source: Dawn' })[0]).toHaveAttribute('href', 'https://dawn.example/a')
    expect(screen.getByRole('link', { name: 'Source: Actually Relevant' })).toHaveAttribute('href', '/stories/old-story')
  })

  it('links no URL that is not http(s), and loads favicons only from https without a referrer', () => {
    const { container } = render(<ResearchRunView run={run()} />)
    expect(screen.queryByRole('link', { name: 'Source: Odd Outlet' })).toBeNull()
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    const images = [...container.querySelectorAll('img')]
    expect(images.length).toBeGreaterThan(0)
    for (const img of images) {
      expect(img.getAttribute('src')).toMatch(/^https:/)
      expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
    }
  })

  it('says the AI opt-out was not checked', () => {
    render(<ResearchRunView run={run()} />)
    expect(screen.getByText(/AI opt-out not checked/)).toBeInTheDocument()
  })

  it('shows per-step and total USD and the Tavily credits', () => {
    render(<ResearchRunView run={run()} />)
    const table = screen.getByRole('table', { name: 'Cost per step' })
    expect(within(table).getByRole('row', { name: /^write/ })).toHaveTextContent('$0.020')
    expect(within(table).getByRole('row', { name: /^Tavily/ })).toHaveTextContent('4 credits$0.032')
    expect(within(table).getByRole('row', { name: /^Total/ })).toHaveTextContent('$0.052')
  })

  it('shows a failed run with its error and the reservation it keeps', () => {
    render(<ResearchRunView run={run({ status: 'failed', verdict: null, result: null, cost: null, costUsd: 0.25, error: 'unexpected error (Error)' })} />)
    expect(screen.getByText(/Failed: unexpected error \(Error\)\. Its reservation of \$0\.250/)).toBeInTheDocument()
  })

  it('shows a run that failed after its research with its measured cost, not the reservation, and its result', () => {
    render(<ResearchRunView run={run({ status: 'failed', costUsd: 0.052, error: 'unexpected error (Error)' })} />)
    expect(screen.getByText(/^Failed after its research: unexpected error \(Error\)\. Its measured cost of \$0\.052 stays counted/)).toBeInTheDocument()
    expect(screen.queryByText(/reservation/)).toBeNull()
    expect(screen.getByText(/Cost \(\$0\.052\)/)).toBeInTheDocument()
  })

  it('shows a running run whose result is stored at its measured cost', () => {
    render(<ResearchRunView run={run({ status: 'running', costUsd: 0.052, finishedAt: null })} />)
    expect(screen.getByText(/Its measured cost of \$0\.052 counts against the cap/)).toBeInTheDocument()
  })

  it.each([
    ['editor', 'Editor'],
    ['pipeline', 'Pipeline'],
  ] as const)('names who started an %s run', (trigger, name) => {
    render(<ResearchRunView run={run({ trigger })} />)
    expect(screen.getByText('Started by:').parentElement).toHaveTextContent(`Started by: ${name}`)
  })

  it('shows a run the research step skipped as skipped, with nothing counted, rather than as a failure', () => {
    render(
      <ResearchRunView
        run={run({ trigger: 'pipeline', status: 'failed', verdict: null, result: null, cost: null, costUsd: 0, error: 'skipped: monthly cap reached' })}
      />,
    )
    expect(screen.getByText(/^Skipped by the research step: monthly cap reached\. Nothing was researched or counted against the cap/)).toBeInTheDocument()
    expect(screen.queryByText(/^Failed:/)).toBeNull()
  })
})
