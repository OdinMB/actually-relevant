import { it, expect, vi } from 'vitest'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextBox, createContextFact, createContextRun } from '../test/db/storyContext.js'
import { getStoryContext } from './storyContextView.js'

const research = (urls: { S0: string; S2: string }) => ({
  paragraphs: [
    { sentences: [{ text: 'First paragraph.', citations: [{ sourceId: 'S0', sentence: 'x' }] }] },
    { sentences: [{ text: 'Second paragraph.', citations: [{ sourceId: 'S2', sentence: 'y' }] }] },
  ],
  whyThisMatters: [{ text: 'Why it matters.', citations: [{ sourceId: 'S2', sentence: 'y' }] }],
  caveats: [{ text: 'A caveat.', citations: [] }],
  quoteSourceId: null,
  sources: [
    {
      id: 'S0',
      origin: 'original',
      outlet: 'Orig',
      host: 'orig.example',
      url: urls.S0,
      title: 't',
      date: null,
      country: null,
      kind: 'news-report',
      storyId: null,
      slug: null,
    },
    {
      id: 'S2',
      origin: 'source',
      outlet: 'Two',
      host: 's2.example',
      url: urls.S2,
      title: 't',
      date: null,
      country: null,
      kind: 'analysis',
      storyId: null,
      slug: null,
    },
  ],
})

describeDb('getStoryContext', () => {
  useTestDatabase()

  const setup = async (status: 'published' | 'selected' = 'published') => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status, slug: `story-${status}`, datePublished: new Date('2026-11-14T00:30:00Z'), summary: 'S.' })
    const { default: prisma } = await import('../lib/prisma.js')
    await prisma.story.update({ where: { id: story.id }, data: { research: research({ S0: story.sourceUrl, S2: 'https://s2.example/a' }) } })
    const run = await createContextRun(story.id)
    // S2F1 is the research source cited by paragraph 2; S5 a source the second search found
    await createContextFact(story.id, run.id, {
      ref: 'S2F1',
      sourceUrl: 'https://s2.example/a',
      sourceOutlet: 'Two',
      value: 2_600_000,
      unit: 'hectares',
      validity: 'fixed',
      asOf: new Date('2015-01-01'),
      asOfPrecision: 'year',
    })
    await createContextFact(story.id, run.id, {
      ref: 'S5F1',
      sourceUrl: 'https://www.s5.example/b',
      sourceOutlet: 'Five',
      sourceKind: 'official-body',
      value: 2_880_000,
      unit: 'hectares',
      provisional: true,
      validity: 'slow',
      asOf: new Date('2026-11-01'),
      asOfPrecision: 'month',
    })
    await createContextFact(story.id, run.id, {
      ref: 'S5F2',
      sourceUrl: 'https://www.s5.example/b',
      sourceOutlet: 'Five',
      value: 12_500_000,
      unit: 'people',
      approx: 'about',
      validity: 'fast',
      asOf: new Date('2026-11-10'),
      asOfPrecision: 'day',
    })
    await createContextFact(story.id, run.id, {
      ref: 'S5F3',
      sourceUrl: 'https://www.s5.example/b',
      sourceOutlet: 'Five',
      value: 13_000_000,
      unit: 'people',
      verdict: 'rejected',
    })
    return { story, run }
  }

  it('serves the boxes not demoted, in order, with resolved tiles and charts and sources numbered as first cited', async () => {
    const { story, run } = await setup()
    await createContextBox(story.id, run.id, {
      position: 0,
      type: 'who_affected',
      heading: 'People under hazardous smoke',
      place: 'W1',
      visual: { kind: 'tiles', tiles: [{ label: 'people under smoke, 2026', factIds: ['S5F2', 'S5F3'] }] },
      asOf: new Date('2026-11-10'),
      asOfPrecision: 'day',
    })
    await createContextBox(story.id, run.id, {
      position: 1,
      type: 'compared',
      place: 'P2',
      sentences: [
        { text: 'The 2015 fires burned 2.6 million hectares.', factIds: ['S2F1'] },
        { text: 'A rejected claim.', factIds: ['S5F3'] },
      ],
      visual: {
        kind: 'bars',
        measure: 'area burned in Indonesia',
        unit: 'hectares',
        points: [
          { label: '2015', factId: 'S2F1' },
          { label: '2026', factId: 'S5F1' },
        ],
        apart: null,
      },
      asOf: new Date('2026-11-01'),
      asOfPrecision: 'month',
    })
    await createContextBox(story.id, run.id, { position: 2, type: 'why_now', status: 'demoted', sentences: [{ text: 'Hidden.', factIds: ['S2F1'] }] })
    // An honest gap stored before 2026-11-17 (no sentences, no visual) is never served, nor is an In numbers box
    await createContextBox(story.id, run.id, { position: 3, type: 'response', gap: true, model: null, promptVersion: null })
    await createContextBox(story.id, run.id, { position: 4, type: 'figures', visual: { kind: 'tiles', tiles: [{ label: 'area', factIds: ['S5F1'] }] } })

    const view = await getStoryContext('story-published')
    expect(view.boxes.map(b => [b.type, b.place])).toEqual([
      ['who_affected', 'W1'],
      ['compared', 'P2'],
    ])
    // The one tile's label only repeated the heading and the as-of year the footer gives
    expect(view.boxes[0]!.visual).toEqual({
      kind: 'tiles',
      tiles: [{ label: '', values: [{ text: 'about 12.5m', estimate: false, sourceId: 'C1' }] }],
    })
    const compared = view.boxes[1]!
    expect(compared.sentences).toEqual([
      { text: 'The 2015 fires burned 2.6 million hectares.', citations: [{ sourceId: 'C2', sentence: 'Sentence of S2F1.' }] },
    ])
    expect(compared.visual).toMatchObject({
      kind: 'bars',
      caption: 'area burned in Indonesia',
      unit: 'hectares',
      points: [
        { label: '2015', text: '2.6m', provisional: false, recent: false, sourceId: 'C2' },
        { label: '2026', text: '2.88m', provisional: true, recent: true, sourceId: 'C1' },
      ],
    })
    expect(compared.sourceIds).toEqual(['C2', 'C1'])
    expect(compared.asOf).toBe('2026-11')
    expect(view.sources.map(s => [s.id, s.outlet, s.url, s.kind, s.origin])).toEqual([
      ['C1', 'Five', 'https://www.s5.example/b', 'news-report', 'source'],
      ['C2', 'Two', 'https://s2.example/a', 'news-report', 'source'],
    ])
    expect(view.asOf).toBe('2026-11-10')
    expect(view.aiGenerated).toMatchObject({ fields: ['heading', 'teaser', 'sentences', 'visual'], model: 'test-writer' })
  })

  it('sends a box over the limits, or with a place the story lacks, to the section', async () => {
    const { story, run } = await setup()
    const sentence = [{ text: 'x', factIds: ['S2F1'] }]
    await createContextBox(story.id, run.id, { position: 0, place: 'P1', sentences: sentence })
    await createContextBox(story.id, run.id, { position: 1, place: 'P1', sentences: sentence })
    await createContextBox(story.id, run.id, { position: 2, place: 'P9', sentences: sentence })
    expect((await getStoryContext('story-published')).boxes.map(b => b.place)).toEqual(['P1', 'section', 'section'])
  })

  it('serves no boxes for a story not published, one without context, or one whose boxes are all hidden', async () => {
    const { story, run } = await setup('selected')
    await createContextBox(story.id, run.id, { position: 0, sentences: [{ text: 'x', factIds: ['S2F1'] }] })
    expect(await getStoryContext('story-selected')).toMatchObject({ boxes: [], sources: [], asOf: null, aiGenerated: { fields: [] } })
    expect((await getStoryContext('no-such-story')).boxes).toEqual([])
  })

  it('leaves out a box whose every item cites facts no longer shown', async () => {
    const { story, run } = await setup()
    await createContextBox(story.id, run.id, { position: 0, sentences: [{ text: 'x', factIds: ['S5F3'] }] })
    expect((await getStoryContext('story-published')).boxes).toEqual([])
  })

  it("reads the story's text and research only once a box is served", async () => {
    const { default: prisma } = await import('../lib/prisma.js')
    const { story, run } = await setup()
    const reads = vi.spyOn(prisma.story, 'findFirst')
    const texts = vi.spyOn(prisma.story, 'findUnique')
    try {
      await getStoryContext('story-published')
      await createContextBox(story.id, run.id, { position: 0, sentences: [{ text: 'x', factIds: ['S5F3'] }] })
      await getStoryContext('story-published')
      expect(reads.mock.calls.map(([args]) => Object.keys(args?.select ?? {}))).toEqual([
        ['id', 'sourceUrl', 'datePublished'],
        ['id', 'sourceUrl', 'datePublished'],
      ])
      expect(texts).not.toHaveBeenCalled()

      await createContextBox(story.id, run.id, { position: 1, sentences: [{ text: 'y', factIds: ['S2F1'] }] })
      expect((await getStoryContext('story-published')).boxes).toHaveLength(1)
      expect(texts.mock.calls.map(([args]) => args.select)).toEqual([{ summary: true, relevanceReasons: true, antifactors: true, research: true }])
    } finally {
      reads.mockRestore()
      texts.mockRestore()
    }
  })
})
