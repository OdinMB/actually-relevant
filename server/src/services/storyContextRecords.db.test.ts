import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextBox, createContextFact, createContextRun, createResearchRun } from '../test/db/storyContext.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { loadContextInput } from './storyContextInput.js'
import { boxContent, boxRow, contextRecords, factRow } from './storyContextRecords.js'

/** A search fact with every field set, as a run holds it before it stores it. */
const searched: ContextFactData = {
  ref: 'S2F1',
  origin: 'search',
  reusedFromId: null,
  slot: 'compared',
  source: { id: 'S2', url: 'https://s2.example/fires', outlet: 'Outlet S2', title: 'Fires in numbers', date: '2026-11-12', kind: 'official-statistic' },
  supportingSentence: 'Fires burned 2.5 to 3 million hectares by October.',
  passage: 'The season began early. Fires burned 2.5 to 3 million hectares by October. Rain came late.',
  supportFound: true,
  statement: 'Fires burned about 2.5 to 3 million hectares in Indonesia by October 2026.',
  value: 2.5,
  valueHigh: 3,
  unit: 'million hectares',
  approx: 'about',
  provisional: true,
  counted: 'area burned in Indonesia',
  place: 'Indonesia',
  asOf: '2026-10',
  credited: 'Ministry of Forestry',
  creditedKind: 'official',
  validity: 'fixed',
  verdict: 'supported',
  verdictProblem: null,
  model: 'test-structure',
  promptVersion: 'abcd1234',
}

/** A research fact the check rejected, with the fields a search fact fills left empty and an as-of day. */
const rejected: ContextFactData = {
  ...searched,
  ref: 'S0F1',
  origin: 'research',
  slot: null,
  source: { id: 'S0', url: 'https://s0.example/fires', outlet: 'Outlet S0', title: 'Fires', date: null, kind: 'news-report' },
  passage: null,
  supportFound: false,
  value: 1_200,
  valueHigh: null,
  approx: 'at_least',
  provisional: false,
  asOf: '2026-11-03',
  credited: '',
  creditedKind: null,
  validity: 'fast',
  verdict: 'rejected',
  verdictProblem: 'The source gives the figure for the region, not the country.',
}

/** A bars box whose `apart` group cites the newer fact. */
const box: DraftBox = {
  type: 'compared',
  heading: 'Twice the usual',
  teaser: 'Twice the usual area',
  place: 'P1',
  sentences: [{ text: 'It is twice the usual.', factIds: ['S2F1'] }],
  visual: {
    kind: 'bars',
    measure: 'area burned in Indonesia',
    unit: 'million hectares',
    points: [{ label: '2026', factId: 'S2F1' }],
    apart: { measure: 'fires counted', unit: 'fires', points: [{ label: 'November', factId: 'S0F1' }] },
  },
}

describeDb('story context records', () => {
  useTestDatabase()

  it('reads back every field a run stored, through the view and admin reader and through the next story input', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const published = (day: string) => createStory({ feedId: feed.id, status: 'published', datePublished: new Date(`${day}T09:00:00Z`), summary: 'Fires.' })
    const elsewhere = await published('2026-11-01')
    const earlier = await published('2026-11-14')
    const story = await published('2026-11-16')

    const original = await createContextFact(elsewhere.id, (await createContextRun(elsewhere.id)).id, { ref: 'S1F1' })
    const reused: ContextFactData = { ...searched, reusedFromId: original.id }
    const run = await createContextRun(earlier.id)
    const facts = new Map([reused, rejected].map(f => [f.ref, f]))
    const writtenAt = new Date('2026-11-14T03:00:00Z')
    await prisma.contextFact.createMany({ data: [...facts.values()].map(f => factRow(earlier.id, run.id, f)) })
    await prisma.contextBox.createMany({
      data: [boxRow({ storyId: earlier.id, runId: run.id }, box, 0, facts, { model: 'test-writer', promptVersion: 'efgh5678' }, writtenAt)],
    })

    const records = await contextRecords(prisma, earlier.id)
    expect(records.facts.get('S2F1')).toEqual({ ...reused, slot: null, id: expect.any(String), demoted: false })
    expect(records.facts.get('S0F1')).toEqual({ ...rejected, id: expect.any(String), demoted: false })
    expect(records.boxes).toHaveLength(1)
    const stored = records.boxes[0]!
    expect(boxContent(stored)).toEqual({ sentences: box.sentences, visual: box.visual })
    expect(stored).toMatchObject({
      type: 'compared',
      heading: box.heading,
      teaser: box.teaser,
      place: 'P1',
      model: 'test-writer',
      promptVersion: 'efgh5678',
      writtenAt,
    })
    // The apart group's fact is the newest the box cites.
    expect([stored.asOf?.toISOString().slice(0, 10), stored.asOfPrecision]).toEqual(['2026-11-03', 'day'])

    await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { earlier: [earlier.id] })
    const input = await loadContextInput(prisma, story.id)
    expect(input!.reusable).toEqual([{ ...reused, slot: null, id: records.facts.get('S2F1')!.id }])
  })

  it('never reads back an In numbers box stored before 2026-11-17, nor counts a run that wrote only one as a run with boxes', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status: 'published', datePublished: new Date('2026-11-14T09:00:00Z'), summary: 'Fires.' })
    const older = await createContextRun(story.id, { startedAt: new Date('2026-11-14T03:00:00Z') })
    const newer = await createContextRun(story.id, { startedAt: new Date('2026-11-15T03:00:00Z') })
    await createContextBox(story.id, older.id, { position: 0, type: 'figures', writtenAt: new Date('2026-11-14T03:05:00Z') })
    await createContextBox(story.id, older.id, { position: 1, type: 'who_affected', writtenAt: new Date('2026-11-14T03:05:00Z') })
    await createContextBox(story.id, newer.id, { position: 0, type: 'figures', writtenAt: new Date('2026-11-15T03:05:00Z') })

    const records = await contextRecords(prisma, story.id)
    expect(records.boxes.map(b => [b.runId, b.type])).toEqual([[older.id, 'who_affected']])
  })
})
