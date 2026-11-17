import { it, expect, vi } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextBox, createContextFact, createContextRun, createResearchRun } from '../test/db/storyContext.js'
import { getContextAdmin, setContextHidden, updateContextBox } from './storyContextAdmin.js'

describeDb('story context admin', () => {
  useTestDatabase()

  const setup = async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({
      feedId: feed.id,
      status: 'published',
      datePublished: new Date('2026-11-14T00:30:00Z'),
      summary: 'The summary paragraph.',
    })
    await prisma.story.update({ where: { id: story.id }, data: { relevanceReasons: '- First reason\n- Second reason' } })
    await createContextRun(story.id, { startedAt: new Date('2026-11-13T01:00:00Z'), outcome: 'none-kept' })
    const run = await createContextRun(story.id, {
      startedAt: new Date('2026-11-14T01:00:00Z'),
      costUsd: 0.034,
      modelUsd: 0.01,
      tavilyCredits: 3,
      boxes: 3,
      result: { responseNotFound: true },
    })
    await createContextFact(story.id, run.id, {
      ref: 'S2F1',
      sourceUrl: 'https://s2.example/a',
      sourceOutlet: 'Two',
      asOf: new Date('2026-11-01'),
      asOfPrecision: 'month',
    })
    const sentence = [{ text: 'x', factIds: ['S2F1'] }]
    // An In numbers box stored before 2026-11-17: never listed
    const figures = await createContextBox(story.id, run.id, {
      position: 0,
      type: 'figures',
      visual: { kind: 'tiles', tiles: [{ label: 'l', factIds: ['S2F1'] }] },
    })
    const note = await createContextBox(story.id, run.id, {
      position: 1,
      place: 'W2',
      sentences: sentence,
      asOf: new Date('2026-11-01'),
      asOfPrecision: 'month',
    })
    const hidden = await createContextBox(story.id, run.id, { position: 2, type: 'why_now', place: 'P1', sentences: sentence, status: 'demoted' })
    return { story, run, figures, note, hidden }
  }

  it("returns the boxes with status and place, the story's places and the newest run's summary", async () => {
    const { story, run, note, hidden } = await setup()
    const admin = await getContextAdmin(story.id)
    expect(admin.run).toMatchObject({
      id: run.id,
      outcome: 'built',
      costUsd: 0.034,
      modelUsd: 0.01,
      tavilyCredits: 3,
      boxes: 3,
      result: { responseNotFound: true },
    })
    expect(admin.run!.searchUsd).toBeCloseTo(0.024, 10)
    expect(admin.boxes.map(b => [b.type, b.status, b.hidden, b.place, b.storedPlace])).toEqual([
      ['compared', 'unreviewed', false, 'W2', 'W2'],
      ['why_now', 'demoted', true, 'P1', 'P1'],
    ])
    expect(admin.boxes[0]).toMatchObject({ id: note.id, sources: [{ outlet: 'Two', url: 'https://s2.example/a' }], asOf: '2026-11' })
    expect(admin.boxes[1]!.id).toBe(hidden.id)
    expect(admin.places).toEqual([
      { place: 'P1', label: 'Paragraph 1', text: 'The summary paragraph.' },
      { place: 'W1', label: 'Why This Matters 1', text: 'First reason' },
      { place: 'W2', label: 'Why This Matters 2', text: 'Second reason' },
      { place: 'section', label: 'More context', text: '' },
    ])
    expect(admin.placement).toBe('model')
  })

  it('places only the boxes the page serves, so one with nothing left to show takes no spot', async () => {
    const { story, run, note } = await setup()
    // An honest gap stored before 2026-11-17, its place an editor's (placed first): readers see nothing of it
    const gap = await createContextBox(story.id, run.id, {
      position: 3,
      type: 'response',
      place: 'W2',
      placeByEditor: true,
      sentences: [{ text: 'Nothing sourced was found.', factIds: [] }],
    })
    const places = new Map((await getContextAdmin(story.id)).boxes.map(b => [b.id, b.place]))
    expect([places.get(note.id), places.get(gap.id)]).toEqual(['W2', 'W2'])
  })

  it('has no run and no boxes for a story without context, and refuses an unknown story', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status: 'published', datePublished: new Date() })
    expect(await getContextAdmin(story.id)).toMatchObject({ run: null, boxes: [] })
    await expect(getContextAdmin('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ status: 404 })
  })

  it('says whether an editor can gather context, after marking a run cut off by a restart failed', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    try {
      const issue = await createIssue()
      const feed = await createFeed(issue.id)
      const story = await createStory({ feedId: feed.id, status: 'published', datePublished: new Date() })
      expect((await getContextAdmin(story.id)).gather).toEqual({ eligible: false, refusal: expect.stringMatching(/research/i) })

      await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
      expect((await getContextAdmin(story.id)).gather).toEqual({ eligible: true, refusal: null })

      const stale = await createContextRun(story.id, { status: 'running', outcome: null, finishedAt: null, startedAt: new Date(Date.now() - 3 * 60 * 60_000) })
      const admin = await getContextAdmin(story.id)
      expect(admin.run).toMatchObject({ id: stale.id, status: 'failed', error: expect.stringMatching(/interrupted/) })
      expect(admin.gather).toEqual({ eligible: true, refusal: null })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('hides all context and shows it again, deleting nothing', async () => {
    const { story } = await setup()
    await setContextHidden(story.id, true)
    expect((await prisma.contextBox.findMany({ where: { storyId: story.id } })).map(b => b.status)).toEqual(['demoted', 'demoted', 'demoted'])
    await setContextHidden(story.id, false)
    expect((await prisma.contextBox.findMany({ where: { storyId: story.id }, orderBy: { position: 'asc' } })).map(b => b.status)).toEqual([
      'unreviewed',
      'unreviewed',
      'unreviewed',
    ])
    await expect(setContextHidden('00000000-0000-0000-0000-000000000000', true)).rejects.toMatchObject({ status: 404 })
  })

  it('hides, shows and moves one box, the place kept as the editor chose it', async () => {
    const { story, note, hidden } = await setup()
    await updateContextBox(story.id, note.id, { hidden: true })
    expect((await prisma.contextBox.findUniqueOrThrow({ where: { id: note.id } })).status).toBe('demoted')
    await updateContextBox(story.id, hidden.id, { hidden: false, place: 'W1' })
    expect(await prisma.contextBox.findUniqueOrThrow({ where: { id: hidden.id } })).toMatchObject({ status: 'unreviewed', place: 'W1', placeByEditor: true })
    await updateContextBox(story.id, hidden.id, { place: 'section' })
    expect(await prisma.contextBox.findUniqueOrThrow({ where: { id: hidden.id } })).toMatchObject({ place: null, placeByEditor: true })
    expect((await getContextAdmin(story.id)).boxes.find(b => b.id === hidden.id)!.place).toBe('section')
  })

  it('refuses a place the story does not have, an In numbers box stored before 2026-11-17, and a box of another story', async () => {
    const { story, note, figures } = await setup()
    await expect(updateContextBox(story.id, note.id, { place: 'P4' })).rejects.toMatchObject({ status: 400 })
    await expect(updateContextBox(story.id, figures.id, { place: 'P1' })).rejects.toMatchObject({ status: 404 })
    await expect(updateContextBox(story.id, '00000000-0000-0000-0000-000000000000', { hidden: true })).rejects.toMatchObject({ status: 404 })
  })
})
