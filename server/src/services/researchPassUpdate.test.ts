import { describe, it, expect } from 'vitest'
import type { JudgeAnswer } from '../schemas/researchPass.js'
import type { ResearchedStory } from './researchedStory.js'
import type { ArticleText } from './researchPipeline.js'
import { checkNote, demotions, fallbackNote, rewriteTargets, versionChanges, type RuleFact } from './researchPassUpdate.js'

const article = (): ArticleText => ({
  titleLabel: 'Peat fires',
  title: 'Peat fires return to Sumatra',
  story: [
    { text: 'Fires burned 2.88 million hectares.', factIds: ['S0F1'] },
    { text: 'Smoke closed 40 schools.', factIds: ['S1F1'] },
    { text: 'Rain is forecast.', factIds: ['S2F1'] },
  ],
  whyThisMatters: [{ text: 'Smoke reaches millions.', factIds: ['S1F2'] }],
  caveats: [{ text: 'Figures are provisional.', factIds: [] }],
  summary: 'Fires burned 2.88 million hectares in Sumatra.',
  marketingBlurb: 'Peat fires are back in Sumatra.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
})

const cited = (text: string, sourceId: string) => ({ text, citations: [{ sourceId, sentence: `${sourceId} sentence` }] })

/** The projection of `a`, each cited section citing its first fact's source. */
const projection = (a: ArticleText): ResearchedStory => ({
  paragraphs: a.story.map(p => ({ sentences: [cited(p.text, p.factIds[0]?.replace(/F\d+$/, '') ?? 'S0')] })),
  whyThisMatters: a.whyThisMatters.map(b => cited(b.text, 'S1')),
  caveats: a.caveats.map(b => ({ text: b.text, citations: [] })),
  quoteSourceId: null,
  sources: [],
})

const section = (label: string, verdict: JudgeAnswer['sections'][number]['verdict'], factIds: string[] = [], reason = ''): JudgeAnswer['sections'][number] => ({
  label,
  verdict,
  factIds,
  reason,
})

describe('demotions', () => {
  const old = new Map<string, RuleFact>([
    ['S0F1', { measures: 'hectares burned in Sumatra', date: '2026-11-14' }],
    ['S1F1', { measures: 'schools closed', date: '2026-11-14' }],
  ])
  const fresh = new Map<string, RuleFact>([
    ['S5F1', { measures: 'hectares burned in Sumatra', date: '2026-11-20' }],
    ['S5F2', { measures: 'schools closed', date: '2026-11-14' }],
  ])

  it('demotes an old fact a fact found since contradicts, with the facts that do', () => {
    const r = demotions([{ factId: 'S1F1', byFactIds: ['S5F2', 'S9F9'], reason: ' Only 12 schools closed. ' }], { old, fresh })
    expect(r.demoted).toEqual([{ ref: 'S1F1', contradictedBy: ['S5F2'], reason: 'Only 12 schools closed.' }])
  })

  it('keeps a value a newer one of the same measure supersedes', () => {
    const r = demotions([{ factId: 'S0F1', byFactIds: ['S5F1'], reason: 'The count rose.' }], { old, fresh })
    expect(r.demoted).toEqual([])
    expect(r.superseded).toEqual([{ ref: 'S0F1', by: ['S5F1'] }])
  })

  it('names no demotion without an old fact and a fact found since, and one per fact', () => {
    const r = demotions(
      [
        { factId: 'S5F1', byFactIds: ['S5F2'], reason: 'new against new' },
        { factId: 'S1F1', byFactIds: ['S0F1'], reason: 'old against old' },
        { factId: 'S1F1', byFactIds: ['S5F2'], reason: 'first' },
        { factId: 'S1F1', byFactIds: ['S5F2'], reason: 'again' },
      ],
      { old, fresh },
    )
    expect(r.demoted.map(d => d.reason)).toEqual(['first'])
  })
})

describe('rewriteTargets', () => {
  const none = { fresh: new Set<string>(), demoted: new Map<string, string>() }

  it('rewrites a section citing a demoted fact whatever the judge says', () => {
    const plan = rewriteTargets(article(), [section('Story paragraph 2', 'unchanged')], { ...none, demoted: new Map([['S1F1', 'Only 12 schools closed.']]) })
    expect(plan.targets.map(t => t.label)).toEqual(['Story paragraph 2'])
    expect(plan.targets[0]!.problem).toContain('S1F1')
    expect(plan.judgments.find(j => j.label === 'Story paragraph 2')).toMatchObject({ outcome: 'demoted-fact', founding: ['S1F1'] })
  })

  it('leaves a flag that names no new or demoted fact unfounded, and rewrites one that does', () => {
    const plan = rewriteTargets(
      article(),
      [section('Story paragraph 2', 'wrong', ['S1F1'], 'own knowledge'), section('Story paragraph 3', 'substantially_different', ['S5F1', 'S5F1'], 'No rain came.')],
      { fresh: new Set(['S5F1']), demoted: new Map() },
    )
    expect(plan.targets.map(t => t.label)).toEqual(['Story paragraph 3'])
    expect(plan.judgments.find(j => j.label === 'Story paragraph 2')!.outcome).toBe('unfounded')
    expect(plan.judgments.find(j => j.label === 'Story paragraph 3')).toMatchObject({ outcome: 'rewrite', founding: ['S5F1'] })
    expect(plan.targets[0]!.problem).toBe('is substantially different for newer reporting (S5F1): No rain came.')
  })

  it('takes up the title, summary and blurb when the first paragraph is rewritten, as checks that may leave them', () => {
    const plan = rewriteTargets(article(), [section('Story paragraph 1', 'wrong', ['S5F1'], 'The area was 3.1 million hectares.')], {
      fresh: new Set(['S5F1']),
      demoted: new Map(),
    })
    expect(plan.targets.map(t => t.label)).toEqual(['Title', 'Story paragraph 1', 'Summary', 'Blurb'])
    expect(plan.standing.map(t => t.label)).toEqual(['Story paragraph 1'])
    expect(plan.judgments.filter(j => j.outcome === 'follows-opening').map(j => j.label)).toEqual(['Title', 'Summary', 'Blurb'])
  })

  it('rewrites nothing when nothing is flagged', () => {
    const plan = rewriteTargets(article(), [], none)
    expect(plan.targets).toEqual([])
    expect(plan.judgments.every(j => j.outcome === 'unchanged' && j.verdict === null)).toBe(true)
  })
})

describe('versionChanges', () => {
  it('freezes every section the update left, and records the rewritten one with its text before and after', () => {
    const before = article()
    const after = { ...before, story: before.story.map((p, i) => (i === 2 ? { text: 'No rain came.', factIds: ['S5F1'] } : p)) }
    const { changes, frozen } = versionChanges({ article: before, research: projection(before) }, { article: after, research: projection(after) }, new Set())
    expect(changes).toEqual([{ section: 'Story paragraph 3', before: cited('Rain is forecast.', 'S2'), after: cited('No rain came.', 'S5') }])
    expect(frozen).toEqual([
      { part: 'story', from: 0, to: 0 },
      { part: 'story', from: 1, to: 1 },
      { part: 'whyThisMatters', from: 0, to: 0 },
      { part: 'caveats', from: 0, to: 0 },
    ])
  })

  it('records a dropped section by where it was, with no text after, and moves the later ones up', () => {
    const before = article()
    const after = { ...before, story: [before.story[0]!, before.story[2]!] }
    const { changes, frozen } = versionChanges({ article: before, research: projection(before) }, { article: after, research: projection(after) }, new Set(['Story paragraph 2']))
    expect(changes).toEqual([{ section: 'Story paragraph 2', before: cited('Smoke closed 40 schools.', 'S1'), after: null }])
    expect(frozen.filter(k => k.part === 'story')).toEqual([
      { part: 'story', from: 0, to: 0 },
      { part: 'story', from: 2, to: 1 },
    ])
  })

  it('records the title, summary and blurb when their text changed, citing nothing', () => {
    const before = article()
    const after = { ...before, title: 'Peat fires spread across Sumatra', summary: before.summary }
    const { changes } = versionChanges({ article: before, research: projection(before) }, { article: after, research: projection(after) }, new Set())
    expect(changes).toEqual([{ section: 'Title', before: { text: before.title, citations: [] }, after: { text: after.title, citations: [] } }])
  })
})

describe('checkNote', () => {
  const facts = { known: new Set(['S5F1', 'S1F1', 'S0F1']), fresh: new Set(['S5F1']), demoted: new Set(['S1F1']) }

  it('passes a short note citing a fact found since', () => {
    expect(checkNote({ text: 'Officials put the burned area at 3.1 million hectares on November 20, according to the agency.', factIds: ['S5F1'] }, facts)).toEqual([])
  })

  it('passes a note citing a demoted fact alone', () => {
    expect(checkNote({ text: 'Only 12 schools closed, the ministry said.', factIds: ['S1F1'] }, facts)).toEqual([])
  })

  it('fails a note that rests on nothing new', () => {
    expect(checkNote({ text: 'Fires burned 2.88 million hectares.', factIds: ['S0F1'] }, facts)).toEqual([
      'cites no fact found since the story was written or shown wrong by one',
    ])
  })

  it('fails an empty, long, quoting or twice-dashed note, and one citing unknown or no facts', () => {
    expect(checkNote({ text: '  ', factIds: ['S5F1'] }, facts)).toEqual(['is empty'])
    const long = Array.from({ length: 61 }, () => 'word').join(' ')
    expect(checkNote({ text: long, factIds: ['S5F1'] }, facts)).toEqual(['has 61 words; an Update has at most 60'])
    expect(checkNote({ text: 'The agency said “worse” — and more — again.', factIds: ['S9F9'] }, facts)).toEqual([
      'quotes words; an Update has no quotation marks',
      'has more than one em dash',
      'cites S9F9, which is not among the facts',
      'cites no fact found since the story was written or shown wrong by one',
    ])
    expect(checkNote({ text: 'Something changed.', factIds: [] }, facts)).toEqual(['cites no fact'])
  })
})

describe('fallbackNote', () => {
  const c = (section: string, removed = false) => ({ section, before: { text: 'old', citations: [] }, after: removed ? null : { text: 'new', citations: [] } })

  it('names the page sections rewritten and removed and the outlets, once each', () => {
    expect(fallbackNote([c('Story paragraph 2'), c('Caveat 1'), c('Summary'), c('Why This Matters 2', true)], ['Reuters', 'WHO', 'Reuters'])).toBe(
      'Updated: Story paragraph 2 and Caveat 1 rewritten and Why This Matters 2 removed after new reporting from Reuters and WHO.',
    )
  })

  it('names the summary and blurb only when nothing on the page changed, and no outlet when none is known', () => {
    expect(fallbackNote([c('Summary'), c('Blurb')], [])).toBe('Updated: Summary and Blurb rewritten after new reporting.')
  })
})
