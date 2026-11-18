import { describe, it, expect } from 'vitest'
import {
  articleOf,
  firstPassUpdate,
  isPageSection,
  nextVersion,
  publicUpdates,
  sectionTexts,
  undoPlan,
  updatesEarlierStoryIds,
  updatesForReaders,
  versionArticle,
  versionForReaders,
  versionValues,
  withFrozen,
} from './articleVersions.js'
import type { ResearchedSource, ResearchedStory } from './researchedStory.js'
import type { Article, ArticleVersionData, PoolFact } from './researchPool.js'

const source = (id: string, origin: ResearchedSource['origin'] = 'source'): ResearchedSource => ({
  id,
  origin,
  outlet: `Outlet ${id}`,
  host: origin === 'earlier' ? null : `${id.toLowerCase()}.example`,
  url: origin === 'earlier' ? null : `https://${id.toLowerCase()}.example/a`,
  title: `Title ${id}`,
  date: '2026-11-14',
  country: null,
  kind: 'news-report',
  storyId: origin === 'earlier' ? 'earlier-1' : null,
  slug: null,
})

const cited = (text: string, ...sourceIds: string[]) => ({ text, citations: sourceIds.map(sourceId => ({ sourceId, sentence: `${sourceId} says so.` })) })

const projection = (over: Partial<ResearchedStory> = {}): ResearchedStory => ({
  paragraphs: [{ sentences: [cited('Fires burned 2.88 million hectares.', 'S0')] }, { sentences: [cited('Smoke closed 40 schools.', 'S1')] }],
  whyThisMatters: [cited('Smoke reaches millions.', 'S1')],
  caveats: [cited('Figures are provisional.', 'E1')],
  quoteSourceId: null,
  sources: [source('S0', 'original'), source('S1'), source('E1', 'earlier')],
  ...over,
})

const article = (): Article => ({
  titleLabel: 'Peat fires',
  title: 'Peat fires return',
  story: [
    { text: 'Fires burned 2.88 million hectares.', factIds: ['S0F1'] },
    { text: 'Smoke closed 40 schools.', factIds: ['S1F1', 'S1F2'] },
  ],
  whyThisMatters: [{ text: 'Smoke reaches millions.', factIds: ['S1F2'] }],
  caveats: [{ text: 'Figures are provisional.', factIds: ['E1F1'] }],
  summary: 'Fires burned 2.88 million hectares.',
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Peat fires are back.',
  emotionTag: 'calm',
})

const version = (over: Partial<ArticleVersionData> = {}): ArticleVersionData => ({
  id: 'v1',
  number: 1,
  kind: 'first',
  status: 'current',
  passId: 'p1',
  title: 'Peat fires return',
  titleLabel: 'Peat fires',
  summary: 'Fires burned 2.88 million hectares.',
  marketingBlurb: 'Peat fires are back.',
  quote: null,
  quoteAttribution: null,
  relevanceReasons: '- Smoke reaches millions.',
  antifactors: '- Figures are provisional.',
  emotionTag: 'calm',
  research: projection(),
  article: article(),
  changes: [],
  note: null,
  ...over,
})

const fact = (ref: string, supportingSentence: string): Pick<PoolFact, 'ref' | 'sourceRef' | 'supportingSentence'> => ({
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  supportingSentence,
})

describe('versionArticle', () => {
  it('gives the article a version stored', () => {
    expect(versionArticle(version(), { facts: [] })).toEqual(article())
  })

  it("reads a legacy version's facts from its citations: the source's fact with the sentence shown, the date fact for none, nothing for one the pool lacks", () => {
    const legacy = version({
      kind: 'legacy',
      article: null,
      emotionTag: 'not-a-tag',
      research: projection({
        paragraphs: [{ sentences: [cited('Fires burned.', 'S0'), { text: 'On Friday.', citations: [{ sourceId: 'S2', sentence: null }] }] }],
        whyThisMatters: [cited('Smoke reaches millions.', 'S1', 'S9')],
        caveats: [],
        quoteSourceId: 'S1',
      }),
    })
    const facts = [fact('S0F3', 'S0 says so.'), fact('S1F1', 'S1 says so.'), fact('S1F2', 'Something else.')] as PoolFact[]
    const a = versionArticle(legacy, { facts })
    expect(a.story).toEqual([{ text: 'Fires burned. On Friday.', factIds: ['S0F3', 'S2F0'] }])
    expect(a.whyThisMatters).toEqual([{ text: 'Smoke reaches millions.', factIds: ['S1F1'] }])
    expect(a.quoteSourceId).toBe('S1')
    expect(a.emotionTag).toBeUndefined()
  })
})

describe('sectionTexts', () => {
  it('gives each section as readers see it, by its label, the title, summary and blurb citing nothing', () => {
    const texts = sectionTexts(article(), projection())
    expect(texts.get('Story paragraph 2')).toEqual(cited('Smoke closed 40 schools.', 'S1'))
    expect(texts.get('Caveat 1')).toEqual(cited('Figures are provisional.', 'E1'))
    expect(texts.get('Title')).toEqual({ text: 'Peat fires return', citations: [] })
    expect(texts.get('Blurb')).toEqual({ text: 'Peat fires are back.', citations: [] })
  })
})

describe('withFrozen', () => {
  it('keeps each frozen section as readers saw it, byte for byte, and lists only the sources something cites', () => {
    const old = projection()
    const next = projection({
      paragraphs: [{ sentences: [cited('Fires burned 3.1 million hectares.', 'S0', 'S5')] }, { sentences: [cited('REBUILT FROM THE POOL', 'S1')] }],
      whyThisMatters: [cited('REBUILT FROM THE POOL', 'S1')],
      caveats: [],
      sources: [source('S0', 'original'), source('S5'), source('S1')],
    })
    const merged = withFrozen(next, old, [
      { part: 'story', from: 1, to: 1 },
      { part: 'whyThisMatters', from: 0, to: 0 },
    ])
    expect(merged.paragraphs[0]).toEqual(next.paragraphs[0])
    expect(merged.paragraphs[1]).toBe(old.paragraphs[1])
    expect(merged.whyThisMatters[0]).toBe(old.whyThisMatters[0])
    expect(merged.caveats).toEqual([])
    // E1 was cited only by the old caveat, which the new version no longer has
    expect(merged.sources.map(s => s.id)).toEqual(['S0', 'S1', 'S5'])
  })

  it('moves a frozen section to its new place when one before it was dropped, and lists our earlier stories last', () => {
    const old = projection({ caveats: [cited('First caveat.', 'S1'), cited('Second caveat.', 'E1')] })
    const next = projection({ caveats: [cited('REBUILT', 'S1')], sources: [source('S0', 'original'), source('S1')] })
    const merged = withFrozen(next, old, [{ part: 'caveats', from: 1, to: 0 }])
    expect(merged.caveats).toEqual([old.caveats[1]])
    expect(merged.sources.map(s => s.id)).toEqual(['S0', 'S1', 'E1'])
  })

  it('keeps the source a frozen section cites when the rebuilt projection gives its id to another, renaming that id in the rewritten sections', () => {
    const old = projection({ paragraphs: [{ sentences: [cited('Fires burned.', 'S0')] }, { sentences: [cited('Smoke closed schools.', 'E1')] }] })
    const otherEarlier = { ...source('E1', 'earlier'), storyId: 'earlier-2', title: 'Another earlier story' }
    const next = projection({
      paragraphs: [{ sentences: [cited('Fires burned more.', 'S0', 'E1')] }, { sentences: [cited('REBUILT', 'E1')] }],
      whyThisMatters: [],
      caveats: [],
      sources: [source('S0', 'original'), otherEarlier],
    })
    const before = structuredClone(next)
    const merged = withFrozen(next, old, [{ part: 'story', from: 1, to: 1 }])
    expect(merged.paragraphs[1]).toBe(old.paragraphs[1])
    expect(merged.paragraphs[0]!.sentences[0]!.citations.map(c => c.sourceId)).toEqual(['S0', 'E2'])
    expect(merged.sources.map(s => [s.id, s.storyId])).toEqual([
      ['S0', null],
      ['E1', 'earlier-1'],
      ['E2', 'earlier-2'],
    ])
    expect(next).toEqual(before)
  })

  it("keeps the kept quote's source, and the same source under its id is no collision", () => {
    const old = projection({ quoteSourceId: 'S1' })
    const moved = { ...source('S1'), url: 'https://another.example/b', title: 'Another article' }
    const next = projection({
      paragraphs: [{ sentences: [cited('Fires burned more.', 'S0')] }, { sentences: [cited('Smoke closed 12 schools.', 'S1')] }],
      whyThisMatters: [cited('REBUILT', 'S1')],
      caveats: [],
      quoteSourceId: 'S1',
      sources: [source('S0', 'original'), moved],
    })
    const merged = withFrozen(next, old, [{ part: 'whyThisMatters', from: 0, to: 0 }])
    expect(merged.quoteSourceId).toBe('S1')
    expect(merged.paragraphs[1]!.sentences[0]!.citations.map(c => c.sourceId)).toEqual(['S2'])
    expect(merged.sources.map(s => [s.id, s.url])).toEqual([
      ['S0', 'https://s0.example/a'],
      ['S1', 'https://s1.example/a'],
      ['S2', 'https://another.example/b'],
    ])
    // The original is the same article under the same id: nothing renamed
    expect(merged.paragraphs[0]!.sentences[0]!.citations.map(c => c.sourceId)).toEqual(['S0'])
  })
})

describe('nextVersion', () => {
  it('makes the update after the current version, with the article written into the columns', () => {
    const changed = { ...article(), title: 'Peat fires spread', emotionTag: undefined }
    const v = nextVersion(version({ number: 3 }), {
      passId: 'p4',
      article: changed,
      research: projection(),
      changes: [{ section: 'Title', from: 'Title', before: { text: 'Peat fires return', citations: [] }, after: { text: 'Peat fires spread', citations: [] } }],
      note: cited('The area grew.', 'S5'),
    })
    expect(v).toMatchObject({ id: null, number: 4, kind: 'update', status: 'current', passId: 'p4', title: 'Peat fires spread', emotionTag: 'calm' })
    expect(v.relevanceReasons).toBe('- Smoke reaches millions.')
    expect(v.article).toBe(changed)
    expect(v.note).toEqual(cited('The area grew.', 'S5'))
  })

  it('keeps the article a draft carries, its fields alone', () => {
    const draft = { ...article(), rating: 6, oldNews: false, contradicted: false }
    expect(articleOf(draft)).toEqual(article())
  })
})

describe('publicUpdates', () => {
  const at = (day: string) => new Date(`${day}T09:00:00Z`)
  const change = (section: string) => ({ section, from: section, before: cited(`old ${section}`, 'S1'), after: cited(`new ${section}`, 'S5') })
  const research = projection({ sources: [source('S0', 'original'), source('S1'), source('S5'), source('S7')] })

  it('lists the notes of versions not reverted, newest first, each dated by its day with the page sections it changed', () => {
    const updates = publicUpdates([
      { number: 1, kind: 'legacy', status: 'superseded', changes: [], note: null, research, createdAt: at('2026-11-14') },
      {
        number: 2,
        kind: 'update',
        status: 'superseded',
        changes: [change('Story paragraph 2'), change('Summary')],
        note: cited('First.', 'S5'),
        research,
        createdAt: at('2026-11-18'),
      },
      { number: 3, kind: 'update', status: 'reverted', changes: [change('Title')], note: cited('Undone.', 'S6'), research, createdAt: at('2026-11-19') },
      {
        number: 4,
        kind: 'update',
        status: 'current',
        changes: [change('Blurb'), change('Caveat 1')],
        note: cited('Second.', 'S7'),
        research,
        createdAt: at('2026-11-20'),
      },
    ])
    expect(updates).toEqual([
      {
        date: '2026-11-20',
        note: cited('Second.', 'S7'),
        changes: [{ section: 'Caveat 1', before: cited('old Caveat 1', 'S1'), removed: false }],
        sources: [source('S1'), source('S7')],
      },
      {
        date: '2026-11-18',
        note: cited('First.', 'S5'),
        changes: [{ section: 'Story paragraph 2', before: cited('old Story paragraph 2', 'S1'), removed: false }],
        sources: [source('S1'), source('S5')],
      },
    ])
  })

  it('labels each change by where it was in the version before, whose text it shows, so a rewrite after a dropped section is not named twice', () => {
    const updates = publicUpdates([
      {
        number: 2,
        kind: 'update',
        status: 'current',
        changes: [
          { section: 'Story paragraph 2', from: 'Story paragraph 2', before: cited('Smoke closed 40 schools.', 'S1'), after: null },
          { section: 'Story paragraph 2', from: 'Story paragraph 3', before: cited('Rain is forecast.', 'S2'), after: cited('No rain came.', 'S5') },
        ],
        note: cited('Rain did not come.', 'S5'),
        research: projection({ sources: [source('S1'), source('S2'), source('S5')] }),
        createdAt: at('2026-11-18'),
      },
    ])
    expect(updates[0]!.changes).toEqual([
      { section: 'Story paragraph 2', before: cited('Smoke closed 40 schools.', 'S1'), removed: true },
      { section: 'Story paragraph 3', before: cited('Rain is forecast.', 'S2'), removed: false },
    ])
  })

  it('shows the headline, paragraphs, key quote and bullets on the page, never the summary or blurb', () => {
    expect(['Title', 'Story paragraph 1', 'Key quote', 'Why This Matters 1', 'Caveat 2'].every(isPageSection)).toBe(true)
    expect(isPageSection('Summary') || isPageSection('Blurb')).toBe(false)
  })

  it('gives each Update the sources its note and earlier texts cite: from its own version, else the version it replaced', () => {
    const updates = publicUpdates([
      { number: 1, kind: 'first', status: 'superseded', changes: [], note: null, research: projection(), createdAt: at('2026-11-14') },
      // An undone update: not what the next one replaced
      {
        number: 2,
        kind: 'update',
        status: 'reverted',
        changes: [],
        note: cited('Undone.', 'S9'),
        research: projection({ sources: [source('S9')] }),
        createdAt: at('2026-11-16'),
      },
      {
        number: 3,
        kind: 'update',
        status: 'current',
        changes: [{ section: 'Caveat 1', from: 'Caveat 1', before: cited('Figures are provisional.', 'E1', 'S9'), after: null }],
        note: cited('Final figures are in.', 'S5'),
        research: projection({ caveats: [], sources: [source('S0', 'original'), source('S1'), source('S5')] }),
        createdAt: at('2026-11-18'),
      },
    ])
    expect(updates).toHaveLength(1)
    // S5 from the update's own version, E1 from the first, which it replaced; S9 only the undone update listed
    expect(updates[0]!.sources.map(s => s.id)).toEqual(['S5', 'E1'])
    expect(updates[0]!.changes[0]!.before).toEqual(cited('Figures are provisional.', 'E1'))
  })

  it('serves an earlier story no longer published without its citations, the others under their current slugs', () => {
    const update = {
      date: '2026-11-18',
      note: cited('Note.', 'E1', 'S5'),
      changes: [{ section: 'Caveat 1', before: cited('Old.', 'E1', 'E2'), removed: false }],
      sources: [source('S5'), source('E1', 'earlier'), { ...source('E2', 'earlier'), storyId: 'earlier-2' }],
    }
    const [served] = updatesEarlierStoryIds([update]).length === 2 ? updatesForReaders([update], new Map([['earlier-2', 'new-slug']])) : []
    expect(served!.note.citations.map(c => c.sourceId)).toEqual(['S5'])
    expect(served!.changes[0]!.before!.citations.map(c => c.sourceId)).toEqual(['E2'])
    expect(served!.sources.map(s => [s.id, s.slug])).toEqual([
      ['S5', null],
      ['E2', 'new-slug'],
    ])
  })
})

describe('firstPassUpdate', () => {
  const single = {
    title: 'Fires return',
    summary: 'Peat fires burn again.',
    relevanceReasons: '- Smoke harms millions.\n- Schools close.',
    antifactors: '- Early figures.',
  }

  it('records the single-source text a first pass rewrote on a published story, section by section, with its note', () => {
    const update = firstPassUpdate(single, version(), '2026-11-19')
    expect(update.note).toEqual({ text: 'Researched with 1 more source on Nov 19; the story was rewritten from it.', citations: [] })
    expect(update.changes.map(c => [c.section, c.from, c.before?.text, c.after?.text ?? null])).toEqual([
      ['Title', 'Title', 'Fires return', 'Peat fires return'],
      ['Story paragraph 1', 'Story paragraph 1', 'Peat fires burn again.', 'Fires burned 2.88 million hectares.'],
      ['Why This Matters 1', 'Why This Matters 1', 'Smoke harms millions.', 'Smoke reaches millions.'],
      ['Why This Matters 2', 'Why This Matters 2', 'Schools close.', null],
      ['Caveat 1', 'Caveat 1', 'Early figures.', 'Figures are provisional.'],
    ])
  })

  it('counts the outside sources only, and words a version of several', () => {
    const research = projection({ sources: [source('S0', 'original'), source('S1'), source('S2'), source('E1', 'earlier')] })
    expect(firstPassUpdate({ ...single, relevanceReasons: null, antifactors: null }, version({ research }), '2026-11-02').note.text).toBe(
      'Researched with 2 more sources on Nov 2; the story was rewritten from them.',
    )
  })
})

describe('versionForReaders', () => {
  const note = cited('The toll rose.', 'S1')
  const firstUpdate = () => ({ changes: [], note: cited('Researched on Nov 19; the story was rewritten.') })

  it('makes no Update of a rewrite before the story is published: its changes stay, its note goes', () => {
    const update = version({ kind: 'update', note })
    expect(versionForReaders(update, false, firstUpdate)).toEqual({ ...update, note: null })
    expect(publicUpdates([{ ...versionForReaders(update, false, firstUpdate), createdAt: new Date() }])).toEqual([])
  })

  it("keeps a published story's later Update, and makes its first pass one", () => {
    expect(versionForReaders(version({ kind: 'update', note }), true, firstUpdate).note).toEqual(note)
    expect(versionForReaders(version({ kind: 'first', note: null }), true, firstUpdate).note).toEqual(firstUpdate().note)
    expect(versionForReaders(version({ kind: 'first', note: null }), false, firstUpdate).note).toBeNull()
  })
})

describe('undoPlan', () => {
  const v = (number: number, kind: ArticleVersionData['kind'], status: ArticleVersionData['status']) => ({ number, kind, status })

  it('restores the newest earlier version not reverted', () => {
    const plan = undoPlan([v(4, 'update', 'current'), v(3, 'update', 'reverted'), v(2, 'update', 'superseded'), v(1, 'first', 'superseded')])
    expect(plan).toEqual({ current: v(4, 'update', 'current'), previous: v(2, 'update', 'superseded') })
  })

  it('refuses without a current version, on a first or legacy one, and with nothing earlier to restore', () => {
    expect(undoPlan([v(1, 'first', 'reverted')])).toEqual({ refused: 'This story has no current researched version' })
    expect(undoPlan([v(1, 'legacy', 'current')])).toMatchObject({ refused: expect.stringContaining('Only an update') })
    expect(undoPlan([v(2, 'update', 'current'), v(1, 'first', 'reverted')])).toEqual({ refused: 'No earlier version is left to restore' })
  })
})

describe('versionValues', () => {
  it("writes back a version's columns, clearing the single-source relevance summary, and leaves an unknown emotion tag alone", () => {
    expect(versionValues(version())).toEqual({
      title: 'Peat fires return',
      titleLabel: 'Peat fires',
      summary: 'Fires burned 2.88 million hectares.',
      quote: null,
      quoteAttribution: null,
      marketingBlurb: 'Peat fires are back.',
      relevanceReasons: '- Smoke reaches millions.',
      relevanceSummary: null,
      antifactors: '- Figures are provisional.',
      emotionTag: 'calm',
    })
    expect('emotionTag' in versionValues(version({ emotionTag: null }))).toBe(false)
  })
})
