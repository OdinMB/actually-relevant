import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ArticleVersionView, PoolFactView, ResearchPass, ResearchResult, StoryPasses } from '@shared/types'
import { ArticleVersions, EvidencePoolView, passLabel, ResearchPassView } from './ResearchPassView'
import { REMOVED_FIGURE_REASONS } from './removedFigures'

const projection = { paragraphs: [], whyThisMatters: [], caveats: [], quoteSourceId: null, sources: [] } as unknown as ArticleVersionView['research']

const pass = (over: Partial<ResearchPass> = {}): ResearchPass => ({
  id: 'pass-2',
  number: 2,
  trigger: 'editor',
  kind: 'later',
  status: 'completed',
  outcome: 'unchanged',
  verdict: null,
  costUsd: 0.09,
  modelUsd: 0.05,
  tavilyCredits: 5,
  error: null,
  startedAt: '2026-11-16T09:00:00Z',
  finishedAt: '2026-11-16T09:03:00Z',
  versionId: null,
  record: null,
  calls: [],
  problems: [],
  ...over,
})

const version = (over: Partial<ArticleVersionView> = {}): ArticleVersionView => ({
  id: 'v2',
  number: 2,
  kind: 'update',
  status: 'current',
  passId: 'pass-2',
  title: 'Researched headline',
  createdAt: '2026-11-16T09:03:00Z',
  research: projection,
  changes: [],
  note: null,
  ...over,
})

const fact = (over: Partial<PoolFactView>): PoolFactView => ({
  id: 'f',
  ref: 'S1F1',
  sourceRef: 'S1',
  supportingSentence: 'The toll stood at 180.',
  statement: '180 people died.',
  slot: null,
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
  ...over,
})

type UpdateRecord = NonNullable<NonNullable<ResearchPass['record']>['update']>

const update = (over: Partial<UpdateRecord> = {}): UpdateRecord => ({
  calls: [],
  judgments: [],
  demoted: [],
  superseded: [],
  checks: [],
  problems: [],
  failedOn: null,
  note: null,
  error: null,
  ...over,
})

const view = (over: Partial<StoryPasses> = {}): StoryPasses => ({
  passes: [],
  versions: [],
  pool: { sources: [], facts: [], searches: [], dropped: [] },
  legacyRuns: [],
  ...over,
})

/** Opens every closed section of the pass view, so their contents are in the accessibility tree. */
function renderPass(p: ResearchPass, v: StoryPasses = view()) {
  const result = render(<ResearchPassView pass={p} view={v} />)
  for (const summary of result.container.querySelectorAll('summary')) fireEvent.click(summary)
  return result
}

describe('passLabel', () => {
  it('names the pass by number, day, who started it, what came of it and its cost', () => {
    expect(passLabel(pass({ outcome: 'stale' }))).toMatch(/^Pass 2 · .* · editor · old news · \$0\.090$/)
    expect(passLabel(pass({ trigger: 'pipeline', status: 'running', outcome: null }))).toMatch(/· pipeline · running · /)
  })
})

describe('ResearchPassView', () => {
  it.each([
    ['written', 'Written: the story took the researched version this pass wrote.'],
    ['budget', 'Stopped by the budget: the article was left as it was.'],
    ['technical', 'Failed on a technical error: the article was left as it was.'],
    ['unchanged', 'Article unchanged: nothing new makes it wrong or substantially different.'],
    ['update_failed', 'Research found the story out of date and could not fix it: the article stays as it was.'],
  ] as const)('says what a pass with outcome %s did', (outcome, text) => {
    renderPass(pass({ outcome }))
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('names the section an update failed on, and the gate verdict of a first pass', () => {
    const { unmount } = renderPass(pass({ outcome: 'update_failed', record: { update: update({ failedOn: 'Title' }) } }))
    expect(screen.getByText(/could not fix it \(Title\): the article stays/)).toBeInTheDocument()
    unmount()
    renderPass(pass({ kind: 'first', trigger: 'pipeline', outcome: 'contradicted' }))
    expect(screen.getByText('contradicted.')).toBeInTheDocument()
  })

  it("says an editor's pass only recorded a verdict that would reject the story, and the step's pass does not", () => {
    const { unmount } = renderPass(pass({ kind: 'first', trigger: 'editor', outcome: 'stale' }))
    expect(screen.getByText(/^old news\. Recorded only: /)).toBeInTheDocument()
    unmount()
    renderPass(pass({ kind: 'first', trigger: 'pipeline', outcome: 'stale' }))
    expect(screen.queryByText(/Recorded only/)).not.toBeInTheDocument()
  })

  it('says a running pass holds its reservation, and why a pass was skipped or failed', () => {
    const { unmount } = renderPass(pass({ status: 'running', outcome: null, costUsd: 0.25 }))
    expect(screen.getByText(/Running since .*\. Its reservation of \$0\.250 counts against the cap until it ends\./)).toBeInTheDocument()
    unmount()
    const skipped = renderPass(pass({ status: 'skipped', outcome: null }))
    expect(screen.getByText('Skipped: no reason recorded.')).toBeInTheDocument()
    skipped.unmount()
    renderPass(pass({ status: 'failed', outcome: 'technical', error: 'the model timed out' }))
    expect(screen.getByText('Failed: the model timed out. Its $0.090 stays counted against the cap.')).toBeInTheDocument()
  })

  it('shows a later pass’s judgments, the sections it moved, added and removed, and the fixed line it fell back on', () => {
    const p = pass({
      outcome: 'updated',
      versionId: 'v2',
      record: {
        update: {
          calls: [],
          judgments: [
            {
              label: 'Story paragraph 2',
              verdict: 'substantially_different',
              factIds: ['S3F1'],
              reason: 'A new count',
              outcome: 'rewrite',
              founding: ['S3F1'],
            },
            { label: 'Caveat 1', verdict: null, factIds: [], reason: '', outcome: 'follows-opening', founding: [] },
            { label: 'Caveat 2', verdict: 'wrong', factIds: [], reason: 'No fact', outcome: 'unfounded', founding: [] },
          ],
          demoted: [],
          superseded: [],
          checks: [],
          problems: [],
          failedOn: null,
          note: { text: 'Fixed line.', fallback: true, problems: ['unsupported'], checked: 1, copied: 0 },
          error: 'One caveat could not be rewritten',
        },
      },
    })
    const v = version({
      changes: [
        { section: 'Story paragraph 2', from: 'Story paragraph 3', before: { text: 'Old text.', citations: [] }, after: { text: 'New text.', citations: [] } },
        { section: 'Caveat 2', from: 'Caveat 2', before: null, after: { text: 'Added caveat.', citations: [] } },
        { section: 'Caveat 3', from: 'Caveat 3', before: { text: 'Gone caveat.', citations: [] }, after: null },
      ],
      note: { text: 'Fixed line.', citations: [] },
    })
    renderPass(p, view({ versions: [v] }))
    expect(screen.getByText('Version 2, current')).toBeInTheDocument()
    expect(screen.getByText(/substantially different now, rewritten/)).toBeInTheDocument()
    expect(screen.getByText('S3F1')).toBeInTheDocument()
    expect(screen.getByText(/not judged, checked with the rewritten opening/)).toBeInTheDocument()
    expect(screen.getByText(/wrong now, kept: flagged without a fact found since/)).toBeInTheDocument()
    expect(screen.getByText('Story paragraph 3, now Story paragraph 2')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Before none (added)')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'After removed')).toBeInTheDocument()
    expect(screen.getByText('The note written failed its checks, so readers get the fixed line.')).toBeInTheDocument()
    expect(screen.getByText('One caveat could not be rewritten')).toBeInTheDocument()
  })

  it('marks a reverted version, and shows no draft for a first pass that recorded none', () => {
    renderPass(
      pass({ kind: 'first', outcome: 'technical', versionId: 'v1' }),
      view({ versions: [version({ id: 'v1', number: 1, kind: 'first', status: 'reverted' })] }),
    )
    expect(screen.getByText('Version 1, reverted')).toBeInTheDocument()
    expect(screen.getByText('First pass')).toBeInTheDocument()
  })

  it('shows a first pass’s draft as a research run shows it', () => {
    const research = { draft: null, problems: [], calls: [], verdict: { kind: 'keep' } } as unknown as ResearchResult
    renderPass(pass({ kind: 'first', outcome: 'written', record: { research } }))
    expect(screen.getByText('No draft was written.')).toBeInTheDocument()
  })

  it('lists the searches this pass made and the ones it left to earlier passes', () => {
    const v = view({
      pool: {
        sources: [],
        facts: [],
        dropped: [],
        searches: [
          { kind: 'coverage', slot: null, angle: null, query: 'kenya floods', credits: 2, results: 5, cached: false, passId: 'pass-2' },
          { kind: 'gap', slot: 'response', angle: 'elsewhere', query: 'flood response', credits: 0, results: 3, cached: true, passId: 'pass-2' },
          { kind: 'gap', slot: null, angle: null, query: 'other', credits: 1, results: 1, cached: false, passId: 'pass-2' },
          { kind: 'coverage', slot: null, angle: null, query: 'an earlier one', credits: 2, results: 4, cached: false, passId: 'pass-1' },
        ],
      },
    })
    renderPass(pass({ record: { skippedQueries: ['kenya floods toll'], context: { skippedSearches: [{ slot: 'response', query: 'aid' }] } } }), v)
    expect(screen.getByText('Searches (3)')).toBeInTheDocument()
    expect(screen.getByText('Coverage: kenya floods · 5 results, 2 credits')).toBeInTheDocument()
    expect(screen.getByText('Gap · response (elsewhere): flood response · 3 results, 0 credits, cached')).toBeInTheDocument()
    expect(screen.getByText('Gap · slot: other · 1 results, 1 credits')).toBeInTheDocument()
    expect(screen.getByText('kenya floods toll')).toBeInTheDocument()
    expect(screen.getByText('response: aid')).toBeInTheDocument()
  })

  it('says when a pass made no search, added no source and checked nothing', () => {
    renderPass(pass())
    expect(screen.getByText('None made.')).toBeInTheDocument()
    expect(screen.getByText('No new source.')).toBeInTheDocument()
    expect(screen.getByText('The checks found nothing.')).toBeInTheDocument()
    expect(screen.getByText('Cost ($0.090)')).toBeInTheDocument()
    expect(screen.getByText('Models $0.050, searches $0.040 (5 credits).')).toBeInTheDocument()
  })

  it('lists the sources this pass added and the pages it read and left out', () => {
    const v = view({
      pool: {
        sources: [
          {
            id: 's1',
            ref: 'S1',
            origin: 'search',
            url: 'https://one.example/a',
            outlet: 'One',
            title: 'T',
            date: '2026-11-15',
            kind: 'news-report',
            firstPassId: 'pass-2',
          },
          {
            id: 's2',
            ref: 'S2',
            origin: 'original',
            url: 'https://two.example/b',
            outlet: 'Two',
            title: 'T',
            date: null,
            kind: 'news-report',
            firstPassId: null,
          },
        ],
        facts: [],
        searches: [],
        dropped: [
          { url: 'https://x.example', reason: 'opt-out', passId: 'pass-2' },
          { url: 'https://y.example', reason: 'opt-out', passId: 'pass-2' },
          { url: 'https://z.example', reason: 'empty', passId: 'pass-2' },
        ],
      },
    })
    renderPass(pass(), v)
    expect(screen.getByText('Sources (1 new, 2 in the pool)')).toBeInTheDocument()
    expect(screen.getByText('S1 · One')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://one.example/a' })).toHaveAttribute('href', 'https://one.example/a')
    expect(screen.getByText('2026-11-15 · news-report · search')).toBeInTheDocument()
    expect(screen.getByText('Read and left out: 3 (opt-out, empty)')).toBeInTheDocument()
  })

  it('lists the facts this pass rejected, demoted and kept as past values, each with why', () => {
    const checkedBy = { model: 'm', promptVersion: 'p', passId: 'pass-2' }
    const v = view({
      pool: {
        sources: [],
        searches: [],
        dropped: [],
        facts: [
          fact({ id: 'f1', ref: 'S2F1', firstPassId: 'pass-2', checkedBy }),
          fact({ id: 'f2', ref: 'S2F2', firstPassId: 'pass-2', checkedBy, verdict: 'rejected', verdictProblem: 'The page does not say it' }),
          fact({ id: 'f3', ref: 'S2F3', firstPassId: 'pass-2', checkedBy, verdict: 'unjudged' }),
          fact({ id: 'f4', ref: 'S1F1', status: 'demoted', drop: { passId: 'pass-2', reason: 'contradicted', contradictedBy: [] } }),
          fact({ id: 'f5', ref: 'S1F2', status: 'demoted', drop: { passId: 'pass-2', reason: 'editor', contradictedBy: [] } }),
        ],
      },
    })
    renderPass(pass({ record: { update: update({ superseded: [{ ref: 'S1F3', by: ['S2F1'] }] }) } }), v)
    expect(screen.getByText('Facts (3 new, 3 checked, 1 rejected, 2 demoted)')).toBeInTheDocument()
    expect(screen.getByText(/Checked by this pass: 1 supported, 1 rejected, 1 unjudged\./)).toBeInTheDocument()
    expect(screen.getByText('The page does not say it')).toBeInTheDocument()
    expect(screen.getByText('contradicted by newer reporting')).toBeInTheDocument()
    expect(screen.getByText('an editor dropped it')).toBeInTheDocument()
    expect(screen.getByText('Kept as past values, a newer value found: S1F3 (by S2F1).')).toBeInTheDocument()
  })

  it('lists the figures the figure check removed, each with what it counted and the reason its answer gives', () => {
    renderPass(
      pass({
        record: {
          context: {
            removedFigures: [
              { ref: 'S2F3', figure: 'about 2.88 million hectares', counted: 'area burned', answer: 'not-stated' },
              { ref: 'S1F2', figure: '40 percent', counted: '', answer: 'no-answer' },
            ],
          },
        },
      }),
    )
    const row = (ref: string) => screen.getByText(ref).closest('li')!
    expect(screen.getByText('Figures removed: not found in the source')).toBeInTheDocument()
    expect(row('S2F3')).toHaveTextContent('“about 2.88 million hectares” (area burned)')
    expect(row('S2F3')).toHaveTextContent(REMOVED_FIGURE_REASONS['not-stated'])
    expect(row('S2F3')).not.toHaveTextContent(REMOVED_FIGURE_REASONS['no-answer'])
    // Nothing was said to be counted, so the line names none
    expect(row('S1F2').textContent).toBe(`S1F2 “40 percent”${REMOVED_FIGURE_REASONS['no-answer']}`)
  })

  it('shows no removed figures for a pass without a context record, one from before the figure check, or one that removed none', () => {
    for (const record of [null, { context: {} }, { context: { removedFigures: [] } }]) {
      const { unmount } = renderPass(pass({ record }))
      expect(screen.queryByText(/removed: not found in the source/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('says what became of the cards, with the ones the checks dropped', () => {
    renderPass(
      pass({
        record: {
          cards: 'failed',
          cardsError: 'the write timed out',
          context: {
            boxDrops: [
              { label: 'Response', cause: 'check', problem: 'unsupported' },
              { label: 'Next', cause: 'expired' },
            ],
          },
        },
      }),
    )
    expect(
      screen.getByText(/The cards failed; the article stands\. the write timed out\. Hide or move the cards shown on the Context tab\./),
    ).toBeInTheDocument()
    expect(screen.getByText('Dropped Response: check, unsupported')).toBeInTheDocument()
    expect(screen.getByText('Dropped Next: expired')).toBeInTheDocument()
  })

  it('lists the checks’ problems the server gives with their causes, and the cost per step of the calls as the server names them', () => {
    renderPass(
      pass({
        // Stored calls by their pipelines' own names: the view never reads them
        record: { update: update({ calls: [{ step: 'write', outcome: 'ok', costUsd: 1, model: 'stale' }], problems: [] }) },
        calls: [
          { step: 'judge', costUsd: 0.01, model: 'model-a' },
          { step: 'judge', costUsd: 0.02, model: 'model-b' },
          { step: 'write', costUsd: 0.03, model: 'model-c' },
          { step: 'cards-write', costUsd: 0.005, model: 'model-a' },
        ],
        problems: [
          { label: 'Story paragraph 2', text: 't', problem: 'not in its facts', kind: 'fact', by: 'judge' },
          { label: 'Caveat 1', text: 't', problem: 'too close to the source', kind: 'copying', by: 'code' },
          { label: 'Title', text: 't', problem: 'an old problem' },
        ],
      }),
    )
    expect(screen.getByText('Checks (3 problems)')).toBeInTheDocument()
    expect(screen.getByText('Story paragraph 2: not in its facts (fact, AI check)')).toBeInTheDocument()
    expect(screen.getByText('Caveat 1: too close to the source (copying, code check)')).toBeInTheDocument()
    expect(screen.getByText('Title: an old problem')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Cost per step' })
    const judge = within(table).getByRole('rowheader', { name: 'judge' }).closest('tr')!
    expect(judge).toHaveTextContent('2model-a, model-b$0.030')
    // Research's article write and the cards' write are two rows
    expect(within(table).getByRole('rowheader', { name: 'write' }).closest('tr')).toHaveTextContent('1model-c$0.030')
    expect(within(table).getByRole('rowheader', { name: 'cards-write' }).closest('tr')).toHaveTextContent('1model-a$0.005')
    expect(within(table).queryByText('stale')).not.toBeInTheDocument()
  })

  it('counts one problem in the singular', () => {
    renderPass(pass({ kind: 'first', outcome: 'fallback', problems: [{ label: 'Title', text: 't', problem: 'p' }] }))
    expect(screen.getByText('Checks (1 problem)')).toBeInTheDocument()
    expect(screen.getByText("today's format.")).toBeInTheDocument()
  })
})

describe('ArticleVersions', () => {
  it('lists each version with its kind, state, headline and Update note, and nothing without versions', () => {
    const { container, rerender } = render(<ArticleVersions versions={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(
      <ArticleVersions
        versions={[
          version({ note: { text: 'The toll was revised.', citations: [] } }),
          version({ id: 'v1', number: 1, kind: 'legacy', status: 'superseded', title: null }),
        ]}
      />,
    )
    fireEvent.click(screen.getByText('Versions (2)'))
    expect(screen.getByText(/^Version 2 · update · current · /)).toBeInTheDocument()
    expect(screen.getByText(/^Version 1 · from research before passes · superseded · /)).toBeInTheDocument()
    expect(screen.getByText('Update: The toll was revised.')).toBeInTheDocument()
  })
})

describe('EvidencePoolView', () => {
  it('lists every source with its facts and each fact’s state, and nothing for an empty pool', () => {
    const { container, rerender } = render(<EvidencePoolView view={view()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(
      <EvidencePoolView
        view={view({
          pool: {
            sources: [
              {
                id: 's1',
                ref: 'S1',
                origin: 'search',
                url: 'https://one.example/a',
                outlet: 'One',
                title: 'T',
                date: null,
                kind: 'news-report',
                firstPassId: null,
              },
              {
                id: 's2',
                ref: 'S2',
                origin: 'cluster',
                url: 'https://two.example/b',
                outlet: 'Two',
                title: 'T',
                date: null,
                kind: 'news-report',
                firstPassId: null,
              },
            ],
            facts: [
              fact({ id: 'f1', ref: 'S1F1' }),
              fact({ id: 'f2', ref: 'S1F2', verdict: 'rejected', verdictProblem: 'Not on the page' }),
              fact({ id: 'f3', ref: 'S1F3', verdict: 'rejected' }),
              fact({ id: 'f4', ref: 'S1F4', verdict: 'unjudged' }),
              fact({ id: 'f5', ref: 'S1F5', status: 'demoted', drop: { passId: 'pass-2', reason: 'contradicted', contradictedBy: ['S2F1'] } }),
            ],
            searches: [],
            dropped: [],
          },
        })}
      />,
    )
    fireEvent.click(screen.getByText('Evidence pool (2 sources, 5 facts)'))
    expect(screen.getByText('S1 · One · search')).toBeInTheDocument()
    expect(screen.getByText('(supported)')).toBeInTheDocument()
    expect(screen.getByText('(rejected: Not on the page)')).toBeInTheDocument()
    expect(screen.getByText('(rejected)')).toBeInTheDocument()
    expect(screen.getByText('(not checked yet)')).toBeInTheDocument()
    expect(screen.getByText('(demoted: contradicted by S2F1)')).toBeInTheDocument()
    expect(screen.getByText('No facts.')).toBeInTheDocument()
  })
})
