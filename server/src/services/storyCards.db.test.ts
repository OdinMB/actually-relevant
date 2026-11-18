import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createPass, createPassBox, createPoolFact, createPoolSource } from '../test/db/passes.js'
import { createContextBox, createContextFact, createContextRun } from '../test/db/storyContext.js'
import { cardRecords } from './storyCards.js'
import { getContextAdmin, setContextHidden, updateContextBox } from './storyContextAdmin.js'
import { getStoryContext } from './storyContextView.js'

describeDb('story cards: the newest pass’s, else the legacy run’s', () => {
  useTestDatabase()

  const published = async (slug: string) => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status: 'published', slug, datePublished: new Date('2026-11-14T00:30:00Z'), summary: 'The summary.' })
    await prisma.story.update({ where: { id: story.id }, data: { relevanceReasons: '- First reason\n- Second reason' } })
    return story
  }

  /** A story with a legacy context run's card, and two passes' cards over its pool: the second's are served. */
  const setup = async () => {
    const story = await published('story-with-passes')
    const run = await createContextRun(story.id)
    await createContextFact(story.id, run.id, { ref: 'S2F1' })
    const legacy = await createContextBox(story.id, run.id, {
      position: 0,
      heading: 'Legacy card',
      place: 'W1',
      sentences: [{ text: 'Legacy.', factIds: ['S2F1'] }],
    })

    const first = await createPass(story.id, 1, { finishedAt: new Date('2026-11-14T02:00:00Z') })
    const second = await createPass(story.id, 2, { finishedAt: new Date('2026-11-16T02:00:00Z') })
    const s1 = await createPoolSource(story.id, 'S1', { outlet: 'One', firstPassId: first.id })
    await createPoolFact(s1, { ref: 'S1F1', firstPassId: first.id })
    // Demoted by the second pass: what cites it is shown no more
    await createPoolFact(s1, { ref: 'S1F2', firstPassId: first.id, status: 'demoted', dropReason: 'contradicted', droppedPassId: second.id })
    await createPoolFact(s1, { ref: 'S1F3', firstPassId: first.id, verdict: 'rejected' })
    const older = await createPassBox(story.id, first.id, {
      position: 0,
      heading: 'First pass card',
      sentences: [{ text: 'Old.', factIds: ['S1F1'] }],
      writtenAt: new Date('2026-11-14T02:00:00Z'),
    })
    const writtenAt = new Date('2026-11-16T02:00:00Z')
    const compared = await createPassBox(story.id, second.id, {
      position: 0,
      heading: 'Second pass card',
      place: 'W2',
      sentences: [
        { text: 'Kept.', factIds: ['S1F1'] },
        { text: 'Gone.', factIds: ['S1F2'] },
      ],
      writtenAt,
    })
    const whyNow = await createPassBox(story.id, second.id, {
      position: 1,
      type: 'why_now',
      heading: 'Nothing left',
      place: 'P1',
      sentences: [{ text: 'Rejected.', factIds: ['S1F3'] }],
      writtenAt,
    })
    return { story, legacy, second, older, compared, whyNow, writtenAt }
  }

  it('reads the newest pass’s cards with the pool’s facts, a demoted fact marked', async () => {
    const { story, second, compared, whyNow, writtenAt } = await setup()
    const records = await cardRecords(prisma, story.id)
    expect(records.pass).toEqual({ id: second.id, number: 2, writtenAt })
    expect(records.boxes.map(b => b.id)).toEqual([compared.id, whyNow.id])
    expect([...records.facts.keys()]).toEqual(['S1F1', 'S1F2', 'S1F3'])
    expect(records.facts.get('S1F1')).toMatchObject({ verdict: 'supported', demoted: false, source: { id: 'S1', outlet: 'One' }, value: 212 })
    expect(records.facts.get('S1F2')).toMatchObject({ demoted: true })
  })

  it('serves readers the newest pass’s cards, leaving out what cites a demoted or rejected fact', async () => {
    await setup()
    const view = await getStoryContext('story-with-passes')
    expect(view.boxes.map(b => [b.heading, b.place, b.sentences.map(s => s.text)])).toEqual([['Second pass card', 'W2', ['Kept.']]])
    expect(view.boxes[0]!.sentences[0]!.citations).toEqual([{ sourceId: 'C1', sentence: 'Sentence of S1F1.' }])
    expect(view.sources).toMatchObject([{ id: 'C1', outlet: 'One', url: 'https://s1.example/story' }])
    expect(view.aiGenerated.fields).not.toHaveLength(0)
  })

  it('serves the legacy run’s cards while the story has no pass cards', async () => {
    const story = await published('story-without-passes')
    const run = await createContextRun(story.id)
    await createContextFact(story.id, run.id, { ref: 'S2F1' })
    await createContextBox(story.id, run.id, { position: 0, heading: 'Legacy card', sentences: [{ text: 'Legacy.', factIds: ['S2F1'] }] })
    // A pass that wrote no cards leaves the legacy ones served
    await createPass(story.id, 1)
    expect((await cardRecords(prisma, story.id)).pass).toBeNull()
    expect((await getStoryContext('story-without-passes')).boxes.map(b => b.heading)).toEqual(['Legacy card'])
    expect((await getContextAdmin(story.id)).pass).toBeNull()
  })

  it('lists the pass’s cards for the admin, with the pass that wrote them', async () => {
    const { story, second, compared, whyNow, writtenAt } = await setup()
    const admin = await getContextAdmin(story.id)
    expect(admin.pass).toEqual({ id: second.id, number: 2, writtenAt })
    expect(admin.boxes.map(b => [b.id, b.place, b.sources])).toEqual([
      [compared.id, 'W2', [{ outlet: 'One', url: 'https://s1.example/story' }]],
      [whyNow.id, 'P1', [{ outlet: 'One', url: 'https://s1.example/story' }]],
    ])
  })

  it('hides, shows and moves the served pass cards, and leaves the legacy cards as they are', async () => {
    const { story, legacy, older, compared } = await setup()
    await setContextHidden(story.id, true)
    expect((await prisma.passBox.findMany({ where: { storyId: story.id, passId: compared.passId } })).map(b => b.status)).toEqual(['demoted', 'demoted'])
    expect((await prisma.contextBox.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe('unreviewed')
    expect((await prisma.passBox.findUniqueOrThrow({ where: { id: older.id } })).status).toBe('unreviewed')
    expect((await getStoryContext('story-with-passes')).boxes).toEqual([])

    await setContextHidden(story.id, false)
    await updateContextBox(story.id, compared.id, { place: 'P1' })
    expect(await prisma.passBox.findUniqueOrThrow({ where: { id: compared.id } })).toMatchObject({ status: 'unreviewed', place: 'P1', placeByEditor: true })
    await updateContextBox(story.id, compared.id, { hidden: true })
    expect((await prisma.passBox.findUniqueOrThrow({ where: { id: compared.id } })).status).toBe('demoted')
  })

  it('still edits a legacy card by its id, and refuses a card of another story', async () => {
    const { story, legacy } = await setup()
    await updateContextBox(story.id, legacy.id, { hidden: true })
    expect((await prisma.contextBox.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe('demoted')

    const other = await published('another-story')
    await expect(updateContextBox(other.id, legacy.id, { hidden: true })).rejects.toMatchObject({ status: 404 })
  })
})
