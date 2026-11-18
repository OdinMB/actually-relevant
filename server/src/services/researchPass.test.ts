import { describe, expect, it } from 'vitest'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import type { Draft, Extraction, FactCheck } from '../schemas/research.js'
import type { GapList } from '../schemas/storyContext.js'
import { articleOf } from './articleVersions.js'
import { buildResearchedStory } from './researchedStory.js'
import type { CitationProblem } from './researchChecks.js'
import { passCalls, passItemTally, runResearchPass, type PassDeps, type PassInput, type PassRecord, type PassStep } from './researchPass.js'
import type { UpdateRecord } from './researchPassLater.js'
import type { ResearchStory } from './researchInput.js'
import { emptyResearch, type CheckPass, type ResearchSearchAnswer } from './researchPipeline.js'
import { emptyContextRecord } from './storyContextPipeline.js'
import { cardFacts, EMPTY_POOL, researchView, type Pool, type PoolFact, type PoolSource } from './researchPool.js'
import { storyLayout } from './storyContextLayout.js'
import { boxRefs } from './storyContextRecords.js'

const words = (seed: string, n = 150) => Array.from({ length: n }, (_, i) => `${seed}w${i}`).join(' ')

const original = {
  storyId: 'story-1',
  title: 'Pakistan adds 22GW of rooftop solar',
  url: 'https://www.pakistantoday.com.pk/solar',
  outlet: 'Pakistan Today',
  language: 'en',
  datePublished: '2026-11-12T06:00:00.000Z',
  dateCrawled: '2026-11-12T08:00:00.000Z',
  content: `Pakistan has added 22GW of rooftop solar in just two years. ${words('original')}`,
}

const story: ResearchStory = {
  id: 'story-1',
  slug: 'pakistan-solar',
  datePublished: '2026-11-13T07:00:00.000Z',
  original,
  assess: {
    title: original.title,
    content: original.content,
    publisher: 'Pakistan Today',
    url: original.url,
    guidelines: { factors: 'f', antifactors: 'a', ratings: 'r' },
    emotionTag: 'calm',
  },
  published: {
    titleLabel: 'Solar power',
    title: 'Pakistan adds 22 GW of rooftop solar',
    summary: 'Summary',
    whyThisMatters: '- why',
    caveats: '- caveat',
    relevance: 6,
    relevanceCalculation: '- calc',
    quote: null,
    quoteAttribution: null,
    marketingBlurb: null,
  },
  clusterMembers: [
    { ...original, storyId: 'member-1', url: 'https://dawn.com/solar', outlet: 'Dawn', content: `Dawn reports the solar boom. ${words('dawn')}` },
  ],
  neighbours: [],
  earlier: [],
}

const extraction = (): Extraction => ({
  usable: true,
  relation: 'same-development',
  kind: 'news-report',
  outlet: '',
  country: 'Pakistan',
  facts: [
    {
      statement: 'Pakistan added 22 GW of rooftop solar in two years.',
      supportingSentence: 'Pakistan has added 22GW of rooftop solar in just two years.',
      measures: '',
    },
    { statement: 'The boom cut grid demand.', supportingSentence: 'The boom cut grid demand.', measures: '' },
  ],
  voices: [],
})

const draft = (factIds = ['S0F1']): Draft => ({
  titleLabel: 'Solar power',
  title: 'Pakistan adds 22 GW of rooftop solar',
  story: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', factIds }],
  summary: 'Summary',
  whyThisMatters: [{ text: 'Cheap power reaches millions.', factIds: [] }],
  caveats: [{ text: 'The grid lags behind.', factIds: [] }],
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Pakistan added 22 GW of rooftop solar.',
  emotionTag: 'uplifting',
  relevanceCalculation: ['- **Energy:** 6'],
  rating: 6,
  oldNews: { isOld: false, firstHappened: 'unknown' },
  contradicted: { isContradicted: false, factIds: [] },
})

const items = (prompt: string) => [...prompt.matchAll(/<ITEM number="(\d+)" label="([^"]+)">/g)].map(m => ({ number: Number(m[1]), label: m[2]! }))

/** Every item supported, but those whose label names one of `reject`. */
const checking =
  (reject: string[] = []) =>
  (prompt: string): FactCheck => ({
    items: items(prompt).map(i => ({
      number: i.number,
      supported: !reject.some(ref => i.label === `Fact ${ref}`),
      problem: reject.some(ref => i.label === `Fact ${ref}`) ? 'Not in the sentence.' : '',
      key: false,
      copiedSentence: '',
      followsSource: '',
    })),
  })

const fields = {
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

const gap = (): GapList => ({
  slots: [
    { slot: 'compared', needed: true, covered: 'partly' },
    { slot: 'response', needed: true, covered: 'yes' },
  ],
  responseInStory: '',
  responseSearches: { action: '', elsewhere: '' },
  searches: [],
})

type Responder = Partial<Record<PassStep, (prompt: string) => unknown>>

const noVisual = { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null }

const responders = (over: Responder = {}): Responder => ({
  queries: () => ({ queries: [{ query: 'Pakistan rooftop solar 22 GW', language: 'en' }] }),
  extract: () => extraction(),
  write: () => draft(),
  'fact-check': checking(),
  structure: prompt => ({ facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({ id: m[1], ...fields })) }),
  'gap-list': () => gap(),
  'facts-check': checking(),
  'cards-write': () => ({
    boxes: [
      {
        slot: 'compared',
        heading: 'Twice as fast',
        teaser: '',
        place: 'P1',
        sentences: [{ text: 'Solar grew twice as fast.', factIds: ['S1F2'] }],
        visual: noVisual,
      },
    ],
  }),
  'box-check': checking(),
  ...over,
})

/** A responder's answer for a call the budget skips. */
const SKIP = Symbol('skip')

function fakeDeps(over: Responder = {}, search: ResearchSearchAnswer = { results: [], credits: 2 }) {
  const calls: { step: PassStep; prompt: string }[] = []
  const answers = responders(over)
  const deps: PassDeps = {
    async call(step, _schema, prompt) {
      calls.push({ step, prompt })
      const answer = answers[step]?.(prompt) ?? null
      const outcome = answer === SKIP ? 'skipped' : answer === null ? 'error' : 'ok'
      return {
        parsed: outcome === 'ok' ? (answer as never) : null,
        outcome,
        usage: ZERO_USAGE,
        costUsd: outcome === 'skipped' ? 0 : 0.001,
        model: `model-${step}`,
      }
    },
    tavily: { search: async () => search },
    search: async () => ({ results: [], credits: 1, cached: false }),
    relevanceMin: 5,
  }
  return { deps, calls, stepsCalled: () => calls.map(c => c.step) }
}

const input = (pool: Pool = EMPTY_POOL): PassInput => ({
  passId: 'pass-1',
  story,
  pool,
  version: null,
  current: {
    title: story.published.title,
    summary: 'Summary',
    layout: storyLayout({ url: original.url, summary: 'Summary', relevanceReasons: '- why', antifactors: '- caveat', research: null }),
  },
  storyDay: '2026-11-13',
  reusable: [],
  lastPassDay: null,
  today: '2026-11-13',
})

describe('runResearchPass, a first pass', () => {
  it("makes version 1 of a draft rated below the publish bar too, as research's step applies one", async () => {
    const fake = fakeDeps({})
    const result = await runResearchPass(input(), { ...fake.deps, relevanceMin: 11 })
    expect(result).toMatchObject({ outcome: 'research-rating', verdict: { kind: 'research-rating' } })
    expect(result.version).toMatchObject({ number: 1, kind: 'first', passId: 'pass-1' })
  })

  it('checks each fact once, writes the article from the supported ones only, and makes it version 1 with its cards', async () => {
    const fake = fakeDeps({ 'facts-check': checking(['S1F1']) })
    const result = await runResearchPass(input(), fake.deps)

    expect(result).toMatchObject({ kind: 'first', status: 'completed', outcome: 'written', verdict: { kind: 'keep' } })
    const checked = fake.calls.filter(c => c.step === 'facts-check').flatMap(c => items(c.prompt).map(i => i.label))
    expect(checked.sort()).toEqual(['Fact S0F1', 'Fact S0F2', 'Fact S1F1', 'Fact S1F2'])
    const write = fake.calls.find(c => c.step === 'write')!.prompt
    expect(write).toContain('<FACT id="S1F2">')
    expect(write).not.toContain('<FACT id="S1F1">')
    expect(result.pool.facts.map(f => [f.ref, f.verdict, f.checkedBy?.passId])).toEqual([
      ['S0F1', 'supported', 'pass-1'],
      ['S0F2', 'supported', 'pass-1'],
      ['S1F1', 'rejected', 'pass-1'],
      ['S1F2', 'supported', 'pass-1'],
    ])
    expect(result.version).toMatchObject({ number: 1, kind: 'first', passId: 'pass-1', title: 'Pakistan adds 22 GW of rooftop solar' })
    expect(result.version?.research.sources.map(s => s.id)).toEqual(['S0'])
    // The failure share's items: the draft's three cited sections, checked once each, none failing
    expect(passItemTally(result.record)).toEqual({ checked: 3, failed: 0 })
    expect(result.record.cards).toBe('written')
    expect(result.boxes.map(b => b.type)).toEqual(['compared'])
    expect(result.pool.searches.map(s => [s.kind, s.query, s.passId])).toEqual([['coverage', 'Pakistan rooftop solar 22 GW', 'pass-1']])
    // Every call under its pass step's name, research's first; the cards' facts as context reads them
    expect(new Set(passCalls(result.record).map(c => c.step))).toEqual(new Set(fake.stepsCalled()))
    expect(passCalls(result.record)[0]?.step).toBe('queries')
    expect(cardFacts(result.pool).map(f => [f.ref, f.verdict, f.source.id])).toEqual([
      ['S0F1', 'supported', 'S0'],
      ['S0F2', 'supported', 'S0'],
      ['S1F1', 'rejected', 'S1'],
      ['S1F2', 'supported', 'S1'],
    ])
  })

  it('never checks a fact again that an earlier run judged, nor searches a query made before, nor reads a page the pool holds', async () => {
    const dawn: PoolSource = {
      id: 'src-1',
      ref: 'S4',
      origin: 'cluster',
      earlierStoryId: null,
      url: 'https://dawn.com/solar',
      outlet: 'Dawn',
      title: 'Dawn',
      date: '2026-11-12',
      kind: 'news-report',
      country: 'Pakistan',
      relation: 'same-development',
      favicon: null,
      usedRawContent: false,
      voices: [],
      optOutChecked: true,
      firstPassId: null,
    }
    const judged: PoolFact = {
      id: 'fact-1',
      ref: 'S4F1',
      sourceRef: 'S4',
      reusedFromId: null,
      supportingSentence: 'Dawn reports the solar boom.',
      passage: null,
      supportFound: true,
      statement: 'The solar boom continues.',
      measures: '',
      slot: null,
      structured: { ...(fields as never), by: { model: 'm', promptVersion: 'v' } },
      extractedBy: { model: 'm', promptVersion: 'legacy' },
      verdict: 'supported',
      verdictProblem: null,
      checkedBy: null,
      status: 'unreviewed',
      firstPassId: null,
      drop: null,
    }
    const pool: Pool = {
      sources: [dawn],
      facts: [judged],
      searches: [
        {
          kind: 'coverage',
          slot: null,
          angle: null,
          query: 'pakistan rooftop solar 22 gw',
          normalizedQuery: 'pakistan rooftop solar 22 gw',
          windowStart: null,
          windowEnd: null,
          depth: null,
          credits: 2,
          results: 1,
          cached: false,
          passId: null,
        },
      ],
      dropped: [],
    }
    const fake = fakeDeps()
    const result = await runResearchPass(input(pool), fake.deps)

    const checked = fake.calls.filter(c => c.step === 'facts-check').flatMap(c => items(c.prompt).map(i => i.label))
    expect(checked).not.toContain('Fact S4F1')
    expect(result.record.skippedQueries).toEqual(['Pakistan rooftop solar 22 GW'])
    // The cluster member the pool holds is not read again: only the original is extracted, and the story falls back
    expect(fake.calls.filter(c => c.step === 'extract')).toHaveLength(0)
    expect(result.outcome).toBe('fallback')
    expect(result.changed).toEqual([])
  })

  it('completes the pass with its article when the cards fail, or the budget stops them', async () => {
    for (const [answer, cards] of [
      [() => null, 'failed'],
      [() => SKIP, 'budget'],
    ] as const) {
      const result = await runResearchPass(input(), fakeDeps({ 'cards-write': answer }).deps)
      expect(result, cards).toMatchObject({ status: 'completed', outcome: 'written', record: { cards }, boxes: [] })
      expect(result.version, cards).not.toBeNull()
    }
  })

  it('ends as a budget fallback, with no article and no cards, when the budget stops a step before the cards', async () => {
    const fake = fakeDeps({ 'facts-check': () => SKIP })
    const result = await runResearchPass(input(), fake.deps)
    expect(result).toMatchObject({ outcome: 'budget', verdict: { kind: 'fallback', reason: 'budget' }, version: null, boxes: [] })
    expect(result.record.research.verdict).toEqual(result.verdict)
    expect(fake.stepsCalled()).not.toContain('write')
    expect(fake.stepsCalled()).not.toContain('cards-write')
  })

  it('still writes cards from the original’s facts when no other report held up', async () => {
    const fake = fakeDeps({
      extract: prompt => (prompt.includes('dawn.com') ? { ...extraction(), usable: false } : extraction()),
      'cards-write': () => ({
        boxes: [{ slot: 'compared', heading: 'H', teaser: '', place: 'section', sentences: [{ text: 'S.', factIds: ['S0F2'] }], visual: noVisual }],
      }),
    })
    const result = await runResearchPass(input(), fake.deps)
    expect(result).toMatchObject({ outcome: 'fallback', version: null, record: { cards: 'written' } })
    expect(result.boxes).toHaveLength(1)
    expect(fake.stepsCalled()).not.toContain('write')
  })

  it('writes no cards for a story research found no fact in, as context does', async () => {
    const fake = fakeDeps({ queries: () => null })
    const result = await runResearchPass(input(), fake.deps)
    expect(result).toMatchObject({ status: 'completed', outcome: 'technical', record: { cards: 'none' }, boxes: [] })
    expect(fake.stepsCalled()).toEqual(['queries'])
  })

  it("offers the cards the facts of the earlier stories it links, never another's, and a cited one joins the pool", async () => {
    const candidate = (id: string) => ({
      id,
      slug: null,
      title: `Earlier ${id}`,
      titleLabel: null,
      summary: `Summary of ${id}.`,
      relevanceSummary: '',
      whyItMatters: '',
      datePublished: '2026-10-01T00:00:00.000Z',
      distance: 0.1,
    })
    const offeredFact = (id: string, url: string) => ({
      ...fields,
      approx: 'exact' as const,
      validity: 'fixed' as const,
      creditedKind: null,
      asOf: null,
      id,
      ref: 'S2F1',
      origin: 'search' as const,
      reusedFromId: null,
      slot: null,
      source: { id: 'S2', url, outlet: 'Outlet', title: 'Title', date: '2026-09-30', kind: 'news-report' },
      supportingSentence: `Sentence of ${id}.`,
      passage: null,
      supportFound: true,
      statement: `Statement of ${id}.`,
      verdict: 'supported' as const,
      verdictProblem: null,
      model: 'm',
      promptVersion: 'v',
    })
    // Facts of a story the pass does not link come first and outnumber the cap; they must not crowd out the linked one
    const unlinked = Array.from({ length: 30 }, (_, i) => ({ storyId: 'earlier-b', fact: offeredFact(`fact-b${i}`, `https://b.example/${i}`) }))
    const fake = fakeDeps({
      earlier: () => ({ stories: [{ number: 1, relation: 'background', facts: [{ statement: 'Earlier A.', supportingSentence: 'Summary of earlier-a.' }] }] }),
      'cards-write': () => ({
        boxes: [{ slot: 'compared', heading: 'H', teaser: '', place: 'section', sentences: [{ text: 'S.', factIds: ['S2F1'] }], visual: noVisual }],
      }),
    })
    const result = await runResearchPass(
      {
        ...input(),
        story: { ...story, earlier: [candidate('earlier-a'), candidate('earlier-b')] },
        reusable: [...unlinked, { storyId: 'earlier-a', fact: offeredFact('fact-a', 'https://a.example/x') }],
      },
      fake.deps,
    )

    const write = fake.calls.find(c => c.step === 'cards-write')!.prompt
    expect(write).toContain('Statement of fact-a.')
    expect(write).not.toContain('Statement of fact-b0.')
    const joined = result.pool.facts.find(f => f.reusedFromId === 'fact-a')
    expect(joined).toMatchObject({ ref: 'S2F1', verdict: 'supported', firstPassId: 'pass-1' })
    expect(result.pool.sources.find(s => s.ref === 'S2')?.url).toBe('https://a.example/x')
    expect(result.boxes[0]?.sentences[0]?.factIds).toEqual(['S2F1'])
    expect(result.boxFacts.get('S2F1')?.reusedFromId).toBe('fact-a')
  })
})

describe('runResearchPass, a later pass', () => {
  const pageSource = (ref: string, url: string, outlet: string, origin: PoolSource['origin']): PoolSource => ({
    id: `src-${ref}`,
    ref,
    origin,
    earlierStoryId: null,
    url,
    outlet,
    title: outlet,
    date: '2026-11-12',
    kind: 'news-report',
    country: 'Pakistan',
    relation: 'same-development',
    favicon: null,
    usedRawContent: false,
    voices: [],
    optOutChecked: true,
    firstPassId: 'pass-0',
  })
  const poolFact = (ref: string, statement: string): PoolFact => ({
    id: `fact-${ref}`,
    ref,
    sourceRef: ref.replace(/F\d+$/, ''),
    reusedFromId: null,
    supportingSentence: `${statement} (sentence)`,
    passage: null,
    supportFound: true,
    statement,
    measures: '',
    slot: null,
    structured: { ...(fields as never), by: { model: 'm', promptVersion: 'v' } },
    extractedBy: { model: 'm', promptVersion: 'v' },
    verdict: 'supported',
    verdictProblem: null,
    checkedBy: { model: 'm', promptVersion: 'v', passId: 'pass-0' },
    status: 'unreviewed',
    firstPassId: 'pass-0',
    drop: null,
  })
  const pool: Pool = {
    sources: [pageSource('S0', original.url, 'Pakistan Today', 'original'), pageSource('S1', 'https://dawn.com/solar', 'Dawn', 'cluster')],
    facts: [poolFact('S0F1', 'Pakistan added 22 GW of rooftop solar in two years.'), poolFact('S1F1', 'Imports of panels doubled.')],
    searches: [],
    dropped: [],
  }
  const article = { ...draft(['S0F1']), whyThisMatters: [{ text: 'Cheap power reaches millions.', factIds: ['S1F1'] }] }
  const v1 = {
    id: 'version-1',
    number: 1,
    kind: 'first' as const,
    status: 'current' as const,
    passId: 'pass-0',
    title: article.title,
    titleLabel: article.titleLabel,
    summary: article.summary,
    marketingBlurb: article.marketingBlurb,
    quote: null,
    quoteAttribution: null,
    relevanceReasons: '- Cheap power reaches millions.',
    antifactors: '- The grid lags behind.',
    emotionTag: 'uplifting',
    research: buildResearchedStory({ draft: article, ...researchView(pool) }),
    article: articleOf(article),
    changes: [],
    note: null,
  }
  const reuters = { ...original, storyId: 'member-2', url: 'https://reuters.com/solar', outlet: 'Reuters', content: `Reuters on the boom. ${words('reuters')}` }
  // A card on the new source's fact, which this pass adds as S2F2
  const laterCards = () => ({
    boxes: [
      { slot: 'compared', heading: 'Less demand', teaser: '', place: 'P1', sentences: [{ text: 'Grid demand fell.', factIds: ['S2F2'] }], visual: noVisual },
    ],
  })
  const later = (over: Partial<PassInput> = {}): PassInput => ({
    ...input(pool),
    passId: 'pass-2',
    story: { ...story, clusterMembers: [...story.clusterMembers, reuters] },
    version: v1,
    lastPassDay: '2026-11-15',
    today: '2026-11-20',
    ...over,
  })

  it('searches only since the last pass, and with nothing flagged makes no version and refreshes the cards', async () => {
    const requests: unknown[] = []
    const fake = fakeDeps({ judge: () => ({ sections: [], contradicted: [] }), 'cards-write': laterCards })
    fake.deps.tavily = { search: async request => (requests.push(request), { results: [], credits: 2 }) }
    const result = await runResearchPass(later(), fake.deps)

    expect(result).toMatchObject({ kind: 'later', status: 'completed', outcome: 'unchanged', version: null, record: { cards: 'written' } })
    expect(requests).toEqual([expect.objectContaining({ startDate: '2026-11-15', endDate: '2026-11-20' })])
    // Dawn, which the pool holds, is not read again: Reuters is the one new source, and the original is not extracted
    expect(fake.calls.filter(c => c.step === 'extract').map(c => c.prompt.includes('reuters.com'))).toEqual([true])
    const judge = fake.calls.find(c => c.step === 'judge')!.prompt
    expect(judge.slice(judge.indexOf('<NEW_FACTS>'))).toContain('Reuters')
    expect(result.record.update?.judgments.every(j => j.outcome === 'unchanged')).toBe(true)
    expect(passCalls(result.record).map(c => c.step)).toContain('judge')
    // The judge's call is priced with the others, so the cap and the spending line count it
    expect(result.modelUsd).toBeCloseTo(
      passCalls(result.record).reduce((sum, c) => sum + c.costUsd, 0),
      10,
    )
  })

  it('makes no card write when the pool gained no supported fact and lost none', async () => {
    const fake = fakeDeps()
    const result = await runResearchPass(later({ story }), fake.deps)
    expect(result).toMatchObject({ outcome: 'unchanged', version: null, boxes: [], record: { cards: 'kept' } })
    expect(fake.stepsCalled()).not.toContain('judge')
    expect(fake.stepsCalled()).not.toContain('cards-write')
  })

  it('rewrites what new facts make substantially different as the next version, demotes the contradicted fact, and rewrites the cards', async () => {
    const fake = fakeDeps({
      judge: () => ({
        sections: [{ label: 'Why This Matters 1', verdict: 'substantially_different', factIds: ['S2F2'], reason: 'The boom now cuts grid demand.' }],
        contradicted: [{ factId: 'S1F1', byFactIds: ['S2F1'], reason: 'Imports did not double.' }],
      }),
      update: () => ({
        items: [{ label: 'Why This Matters 1', text: 'Rooftop panels cut grid demand.', factIds: ['S2F2'] }],
        quote: '',
        quoteAttribution: '',
        quoteSourceId: '',
      }),
      note: () => ({ text: 'Grid demand fell as rooftop panels spread, Reuters reported.', factIds: ['S2F2'] }),
      'cards-write': laterCards,
    })
    const result = await runResearchPass(later(), fake.deps)

    expect(result).toMatchObject({ kind: 'later', outcome: 'updated', record: { cards: 'written' } })
    expect(result.version).toMatchObject({ number: 2, kind: 'update', passId: 'pass-2', relevanceReasons: '- Rooftop panels cut grid demand.' })
    expect(result.version!.changes.map(c => c.section)).toEqual(['Why This Matters 1'])
    expect(result.version!.research.paragraphs[0]).toEqual(v1.research.paragraphs[0])
    expect(result.version!.note?.text).toBe('Grid demand fell as rooftop panels spread, Reuters reported.')
    expect(result.pool.facts.find(f => f.ref === 'S1F1')).toMatchObject({
      status: 'demoted',
      drop: { passId: 'pass-2', reason: 'contradicted', contradictedBy: ['S2F1'] },
    })
    expect(result.changed).toContain('S1F1')
    // The failure share's items: the one rewritten section the update's checks ran on, and no first-pass draft
    expect(passItemTally(result.record)).toEqual({ checked: 1, failed: 0 })
    // The cards are written for the new version's places, from facts the demoted one is no longer among
    const cards = fake.calls.find(c => c.step === 'cards-write')!.prompt
    expect(cards).toContain('Rooftop panels cut grid demand.')
    expect(cards).not.toContain('Imports of panels doubled.')
  })

  it('ends as a budget stop, with its demotions and no version or cards, when the budget stops the rewrite', async () => {
    const fake = fakeDeps({
      judge: () => ({ sections: [], contradicted: [{ factId: 'S1F1', byFactIds: ['S2F1'], reason: 'Imports did not double.' }] }),
      update: () => SKIP,
    })
    const result = await runResearchPass(later(), fake.deps)
    expect(result).toMatchObject({ outcome: 'budget', version: null, boxes: [] })
    expect(result.pool.facts.find(f => f.ref === 'S1F1')?.status).toBe('demoted')
    expect(fake.stepsCalled()).not.toContain('cards-write')
  })

  describe("with an earlier story's fact an earlier pass joined to the pool", () => {
    // The first pass linked earlier-a and joined its offered fact as S2F1; the earlier story offers it again
    const earlierA: PoolSource = { ...pageSource('E1', '', 'Actually Relevant', 'earlier'), earlierStoryId: 'earlier-a', relation: 'background' }
    const joinedSource: PoolSource = { ...pageSource('S2', 'https://a.example/x', 'Outlet', 'search'), relation: 'background' }
    const joined: PoolFact = { ...poolFact('S2F1', 'Statement of fact-a.'), supportingSentence: 'Sentence of fact-a.', reusedFromId: 'fact-a' }
    const joinedPool: Pool = { ...pool, sources: [...pool.sources, earlierA, joinedSource], facts: [...pool.facts, joined] }
    const reusedA = {
      storyId: 'earlier-a',
      fact: {
        ...fields,
        approx: 'exact' as const,
        validity: 'fixed' as const,
        creditedKind: null,
        asOf: null,
        id: 'fact-a',
        ref: 'S2F1',
        origin: 'search' as const,
        reusedFromId: null,
        slot: null,
        source: { id: 'S2', url: 'https://a.example/x', outlet: 'Outlet', title: 'Title', date: '2026-09-30', kind: 'news-report' },
        supportingSentence: 'Sentence of fact-a.',
        passage: null,
        supportFound: true,
        statement: 'Statement of fact-a.',
        verdict: 'supported' as const,
        verdictProblem: null,
        model: 'm',
        promptVersion: 'v',
      },
    }
    /** A card citing every fact the write offers whose text holds `needle`, under whichever ref it was offered. */
    const citing = (needle: string) => (prompt: string) => ({
      boxes: [
        {
          slot: 'compared',
          heading: 'As before',
          teaser: '',
          place: 'P1',
          sentences: [
            {
              text: 'The earlier story reported it.',
              factIds: [...prompt.matchAll(/<FACT id="([^"]+)"[^>]*>([^<]*)<\/FACT>/g)].filter(m => m[2]!.includes(needle)).map(m => m[1]!),
            },
          ],
          visual: noVisual,
        },
      ],
    })
    const secondLater = (over: Partial<PassInput> = {}) => later({ pool: joinedPool, reusable: [reusedA], ...over })
    const unchangedJudge = () => ({ sections: [], contradicted: [] })
    const occurrences = (prompt: string, text: string) => prompt.split(text).length - 1

    it('offers that fact once, under its pool ref, and every ref a card cites is a fact of the pool', async () => {
      const fake = fakeDeps({ judge: unchangedJudge, 'cards-write': citing('Statement of fact-a.') })
      const result = await runResearchPass(secondLater(), fake.deps)

      expect(result.record.cards).toBe('written')
      for (const step of ['gap-list', 'cards-write'] as const)
        expect(occurrences(fake.calls.find(c => c.step === step)!.prompt, 'Statement of fact-a.'), step).toBe(1)
      const refs = new Set(result.pool.facts.map(f => f.ref))
      for (const box of result.boxes) for (const ref of boxRefs(box)) expect(refs, ref).toContain(ref)
      expect(result.boxes.flatMap(boxRefs)).toEqual(['S2F1'])
      expect(result.pool.facts.filter(f => f.reusedFromId === 'fact-a').map(f => f.ref)).toEqual(['S2F1'])
      expect(result.boxFacts.get('S2F1')?.statement).toBe('Statement of fact-a.')
    })

    it('never offers it again once this story’s pool demoted it', async () => {
      const demoted: Pool = {
        ...joinedPool,
        facts: joinedPool.facts.map(f =>
          f.ref === 'S2F1' ? { ...f, status: 'demoted', drop: { passId: 'pass-1', reason: 'contradicted', contradictedBy: ['S1F1'] } } : f,
        ),
      }
      const fake = fakeDeps({ judge: unchangedJudge, 'cards-write': citing('Statement of fact-a.') })
      const result = await runResearchPass(secondLater({ pool: demoted }), fake.deps)

      expect(occurrences(fake.calls.find(c => c.step === 'cards-write')!.prompt, 'Statement of fact-a.')).toBe(0)
      expect(result.boxes.flatMap(boxRefs)).toEqual([])
    })

    it('leaves the cards citing the facts they were written from when a later pass adds a source and keeps them', async () => {
      const second = await runResearchPass(secondLater(), fakeDeps({ judge: unchangedJudge, 'cards-write': citing('Statement of fact-a.') }).deps)
      expect(second.boxes.flatMap(boxRefs).length).toBeGreaterThan(0)

      // A third pass reads one more report, whose facts its fact check rejects: the pool gains no supported fact, so the cards stay
      const bbc = { ...original, storyId: 'member-3', url: 'https://bbc.com/solar', outlet: 'BBC', content: `BBC on the boom. ${words('bbc')}` }
      const rejectAll = (prompt: string): FactCheck => ({
        items: items(prompt).map(i => ({
          number: i.number,
          supported: false,
          problem: 'Not in the sentence.',
          key: false,
          copiedSentence: '',
          followsSource: '',
        })),
      })
      const third = await runResearchPass(
        secondLater({
          passId: 'pass-3',
          pool: second.pool,
          story: { ...story, clusterMembers: [...story.clusterMembers, reuters, bbc] },
          lastPassDay: '2026-11-20',
          today: '2026-11-25',
        }),
        fakeDeps({ 'facts-check': rejectAll }).deps,
      )

      expect(third.record.cards).toBe('kept')
      expect(third.pool.sources.filter(s => s.url === 'https://bbc.com/solar')).toHaveLength(1)
      const byRef = new Map(third.pool.facts.map(f => [f.ref, f]))
      for (const ref of second.boxes.flatMap(boxRefs)) expect(byRef.get(ref)?.statement, ref).toBe(second.boxFacts.get(ref)?.statement)
    })
  })
})

describe('passItemTally', () => {
  const problem = (label: string): CitationProblem => ({ label, text: 'text', problem: 'unsupported', kind: 'fact', by: 'judge' })
  const check = (rechecked: string[] | undefined, failing: string[] = []): CheckPass => ({
    problems: failing.map(problem),
    longestRuns: [],
    unjudged: [],
    numberHints: [],
    ...(rechecked ? { rechecked } : {}),
  })
  const record = (over: Partial<PassRecord>): PassRecord => ({
    research: emptyResearch('story-1', true),
    context: emptyContextRecord(true),
    cards: 'none',
    cardsError: null,
    skippedQueries: [],
    update: null,
    ...over,
  })
  const update = (over: Partial<UpdateRecord>): UpdateRecord => ({
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

  it("counts each of the draft's cited sections once however many rounds checked it, a failing one once, beside the cards' tally", () => {
    const context = { ...emptyContextRecord(true), tally: { checked: 4, failed: 1 } }
    const research = {
      ...emptyResearch('story-1', true),
      draft: {
        ...draft(),
        caveats: [
          { text: 'The grid lags behind.', factIds: [] },
          { text: 'Prices may rise.', factIds: [] },
        ],
      },
      checks: [check(undefined, ['Caveat 2']), check(['Caveat 2'], ['Caveat 2']), check(['Caveat 2'], ['Caveat 2'])],
      problems: [problem('Caveat 2'), problem('Caveat 2')],
    }
    // Story paragraph 1, Why This Matters 1, Caveats 1 and 2
    expect(passItemTally(record({ research, context }))).toEqual({ checked: 4 + 4, failed: 1 + 1 })
  })

  it('counts nothing of an article no check ran on', () => {
    expect(passItemTally(record({ research: { ...emptyResearch('story-1', true), draft: draft() } }))).toEqual({ checked: 0, failed: 0 })
  })

  it("counts a later pass's rechecked sections once each, and a dropped one that failed", () => {
    const later = update({
      checks: [check(['Story paragraph 2', 'Caveat 1'], ['Caveat 1']), check(['Caveat 1'], ['Caveat 1'])],
      problems: [problem('Caveat 1')],
    })
    expect(passItemTally(record({ update: later }))).toEqual({ checked: 2, failed: 1 })
  })
})
