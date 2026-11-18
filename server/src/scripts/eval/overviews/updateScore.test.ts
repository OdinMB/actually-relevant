import { describe, expect, it } from 'vitest'
import { buildResearchedStory } from '../../../services/researchedStory.js'
import type { CheckPass } from '../../../services/researchPipeline.js'
import type { UpdateRecord, UpdateResult } from '../../../services/researchPassLater.js'
import type { SectionJudgment } from '../../../services/researchPassUpdate.js'
import { researchView, type Article, type ArticleVersionData, type PoolFact, type PoolSource } from '../../../services/researchPool.js'
import type { UpdateExpected, UpdateFixture } from './updateFixtures.js'
import { scoreUpdates, type NoteVerdict, type UpdateRun } from './updateScore.js'

const source = (ref: string): PoolSource => ({
  id: null,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url: `https://news.example/${ref}`,
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
})

const fact = (ref: string, statement: string): PoolFact => ({
  id: null,
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  reusedFromId: null,
  supportingSentence: statement,
  passage: null,
  supportFound: true,
  statement,
  measures: '',
  slot: null,
  structured: null,
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
})

const pool = {
  sources: [source('S1'), source('S2')],
  facts: [fact('S1F1', 'Floods displaced 4,000.'), fact('S1F2', 'Tents arrived.'), fact('S2F1', 'Floods displaced 6,000.')],
}

const article: Article = {
  titleLabel: 'Floods',
  title: 'Floods hit the valley',
  story: [
    { text: 'Floods displaced 4,000.', factIds: ['S1F1'] },
    { text: 'Tents arrived.', factIds: ['S1F2'] },
  ],
  whyThisMatters: [],
  caveats: [],
  summary: 'Floods displaced thousands.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Floods in the valley.',
}

const research = buildResearchedStory({ draft: article, ...researchView(pool) })

const version: ArticleVersionData = {
  id: 'v1',
  number: 1,
  kind: 'first',
  status: 'current',
  passId: 'p1',
  title: article.title,
  titleLabel: article.titleLabel,
  summary: article.summary,
  marketingBlurb: article.marketingBlurb,
  quote: null,
  quoteAttribution: null,
  relevanceReasons: null,
  antifactors: null,
  emotionTag: null,
  research,
  article,
  changes: [],
  note: null,
}

const strict = (over: Partial<UpdateExpected> = {}): UpdateExpected => ({ sections: [], facts: [], demote: [], strict: true, ...over })

const fixture = (kind: UpdateFixture['kind'], expected: UpdateExpected): UpdateFixture => ({
  id: `floods:${kind}`,
  slug: 'floods',
  kind,
  input: { storyDay: '2026-10-01', version, pool, fresh: new Set(['S2F1']) },
  expected,
  unplaced: [],
})

const judgment = (label: string, outcome: SectionJudgment['outcome'], founding: string[] = []): SectionJudgment => ({
  label,
  verdict: outcome === 'unchanged' ? 'unchanged' : 'wrong',
  factIds: founding,
  reason: `${label} ${outcome}`,
  outcome,
  founding,
})

const record = (over: Partial<UpdateRecord> = {}): UpdateRecord => ({
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

/** The opening paragraph rewritten on S2F1; the second kept as readers saw it, the very object. */
function updated(over: { second?: unknown; note?: UpdateRecord['note']; checks?: CheckPass[] } = {}): UpdateResult {
  const nextArticle: Article = { ...article, story: [{ text: 'Floods displaced 6,000.', factIds: ['S2F1'] }, article.story[1]!] }
  const built = buildResearchedStory({ draft: nextArticle, ...researchView(pool) })
  const paragraphs = [built.paragraphs[0]!, (over.second ?? research.paragraphs[1]!) as (typeof research.paragraphs)[number]]
  return {
    outcome: 'updated',
    demoted: [{ ref: 'S1F1', contradictedBy: ['S2F1'], reason: 'Six, not four.' }],
    next: {
      article: nextArticle,
      research: { ...built, paragraphs },
      changes: [{ section: 'Story paragraph 1', before: research.paragraphs[0]!.sentences[0]!, after: built.paragraphs[0]!.sentences[0]! }],
      note: { text: 'Updated: the count is now 6,000.', citations: [] },
    },
    record: record({
      judgments: [judgment('Story paragraph 1', 'demoted-fact', ['S1F1']), judgment('Story paragraph 2', 'unchanged'), judgment('Title', 'follows-opening')],
      demoted: [{ ref: 'S1F1', contradictedBy: ['S2F1'], reason: 'Six, not four.' }],
      note: over.note === undefined ? { text: 'The count is now 6,000.', fallback: false, problems: [], checked: 1, copied: 0 } : over.note,
      checks: over.checks ?? [],
    }),
  }
}

const unchanged = (judgments: SectionJudgment[] = [], demoted: UpdateResult['demoted'] = []): UpdateResult => ({
  outcome: 'unchanged',
  demoted,
  next: null,
  record: record({ judgments, demoted }),
})

const good: NoteVerdict = { accurate: true, complete: true, problem: '' }
const run = (f: UpdateFixture, result: UpdateResult, note: NoteVerdict | null = null, n = 1): UpdateRun => ({ fixture: f, run: n, result, note })
const bar = (score: ReturnType<typeof scoreUpdates>, name: string) => score.bars.find(b => b.name === name)!

describe('scoreUpdates', () => {
  const planted = fixture('wrong-number', strict({ sections: [{ label: 'Story paragraph 1', why: 'S1F1 corrected' }], demote: ['S1F1'] }))

  it('scores a planted correction caught, demoted, kept byte for byte elsewhere and noted well', () => {
    const s = scoreUpdates([run(planted, updated(), good)])
    expect(s.bars.map(b => [b.name, b.value, b.met])).toEqual([
      ['flagged', 1, true],
      ['false-rewrites', 0, true],
      ['identical', 1, true],
      ['demoted', 1, true],
      ['false-demotions', 0, true],
      ['notes', 1, true],
      ['unsupported', 0, true],
      ['copying', 0, true],
    ])
    expect(s.runs[0]!.outcomes.updated).toBe(1)
  })

  it('fails the identity bar when a section no change names differs by a byte', () => {
    const second = { sentences: [{ ...research.paragraphs[1]!.sentences[0]!, text: 'Tents arrived!' }] }
    const s = scoreUpdates([run(planted, updated({ second }), good)])
    // Of the title, the second paragraph, the summary and the blurb, one differs
    expect(bar(s, 'identical')).toMatchObject({ value: 0.75, met: false })
  })

  it('counts a missed change, a false rewrite in a strict case only, and a false demotion, and lists each', () => {
    const benign = fixture('benign', strict())
    const turning = fixture('key', { sections: [], facts: [{ ref: 'S2F1', why: 'response: relief camps' }], demote: [], strict: false })
    const s = scoreUpdates([
      run(planted, unchanged([judgment('Story paragraph 1', 'unfounded')])),
      run(
        benign,
        unchanged(
          [judgment('Story paragraph 1', 'rewrite', ['S2F1']), judgment('Story paragraph 2', 'unchanged')],
          [{ ref: 'S1F2', contradictedBy: ['S2F1'], reason: 'r' }],
        ),
      ),
      run(turning, unchanged([judgment('Story paragraph 2', 'rewrite', ['S2F1']), judgment('Story paragraph 1', 'rewrite', ['S2F1'])])),
    ])
    const r = s.runs[0]!
    expect(r.flagged).toEqual({ hit: 1, of: 2, share: 0.5 })
    // The benign case's two sections; the planted case judged only its expected one, and the turning point's case is not strict
    expect(r.falseRewrites).toEqual({ hit: 1, of: 2, share: 0.5 })
    expect(r.demoted).toEqual({ hit: 0, of: 1, share: 0 })
    expect(r.falseDemotions).toEqual({ hit: 1, of: 3, share: 1 / 3 })
    expect(s.listed.missed).toEqual([{ id: 'floods:wrong-number', run: 1, what: 'Story paragraph 1', why: 'S1F1 corrected' }])
    expect(s.listed.falseRewrites.map(f => [f.id, f.label])).toEqual([['floods:benign', 'Story paragraph 1']])
    expect(s.listed.falseDemotions.map(f => [f.id, f.ref])).toEqual([['floods:benign', 'S1F2']])
  })

  it('reads the notes: the judged share, the fixed lines, any served note the checks did not pass, and copying against the paragraphs', () => {
    const check = (copying: boolean): CheckPass => ({
      problems: copying ? [{ label: 'Story paragraph 1', text: 't', problem: 'repeats', kind: 'copying', by: 'code' }] : [],
      longestRuns: [],
      unjudged: [],
      numberHints: [],
      rechecked: ['Story paragraph 1', 'Title'],
    })
    const s = scoreUpdates([
      run(planted, updated({ checks: [check(true)] }), { accurate: true, complete: false, problem: 'Says nothing of why.' }),
      run(
        planted,
        updated({ note: { text: 'Updated: Story paragraph 1 rewritten.', fallback: true, problems: ['p'], checked: 2, copied: 2 }, checks: [check(false)] }),
      ),
      run(planted, updated({ note: { text: 'Bad.', fallback: false, problems: ['fails the fact check'], checked: 1, copied: 0 } }), good),
    ])
    const r = s.runs[0]!
    expect(r.notes).toEqual({ hit: 1, of: 2, share: 0.5, served: 3, fallback: 1, unsupported: 1 })
    expect(r.copying).toEqual({ notes: { hit: 2, of: 4, share: 0.5 }, paragraphs: { hit: 1, of: 2, share: 0.5 } })
    expect(bar(s, 'unsupported')).toMatchObject({ value: 1, met: false })
    expect(bar(s, 'copying')).toMatchObject({ value: 0, met: true })
    expect(s.listed.notes).toEqual([{ id: 'floods:wrong-number', run: 1, note: 'The count is now 6,000.', problem: 'Says nothing of why.' }])
  })

  it('counts a stopped case without measuring it, and reads the bars on the mean over the runs', () => {
    const stopped: UpdateResult = { outcome: 'budget', demoted: [], next: null, record: record() }
    const s = scoreUpdates([run(planted, stopped), run(planted, updated(), good, 2), run(planted, unchanged(), null, 3)])
    expect(s.runs.map(r => [r.run, r.outcomes.budget, r.flagged.share])).toEqual([
      [1, 1, null],
      [2, 0, 1],
      [3, 0, 0],
    ])
    expect(bar(s, 'flagged')).toMatchObject({ value: 0.5, met: false, spread: { n: 2 } })
    expect(scoreUpdates([]).bars.every(b => b.value === null && b.met === null)).toBe(true)
  })
})
