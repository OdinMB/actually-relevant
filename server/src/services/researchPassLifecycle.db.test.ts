/**
 * A research pass's row on PostgreSQL (`researchPassLifecycle.ts`): the claim and its reservation
 * under the one cap, the legacy import it makes once, interrupted and skipped passes. How a claimed
 * pass runs and applies is researchPassRuns.db.test.ts's; its store, passRecords.db.test.ts's.
 */
import type { Prisma } from '@prisma/client'
import { it, expect, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { _setProcessStartedAt } from '../lib/runCutOff.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { claimPass, markInterruptedPasses, PASS_INTERRUPTED, recordSkippedPass } from './researchPassLifecycle.js'
import { monthToDateUsd } from './researchSpend.js'
import type { ResearchedSource, ResearchedStory } from './researchedStory.js'

const FIRST = config.research.pass.firstPassUsd
const LATER = config.research.pass.laterPassUsd
const CAP = config.research.monthlyCapUsd
const MINUTE_MS = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS)

let feedId = ''

async function researchable(status: 'selected' | 'published' = 'selected') {
  return createStory({
    feedId,
    status,
    title: 'Single-source headline',
    summary: 'Single-source summary.',
    relevance: 6,
    slug: status === 'published' ? `story-${Math.random().toString(36).slice(2, 8)}` : null,
    datePublished: status === 'published' ? new Date() : null,
  })
}

const source = (id: string, origin: ResearchedSource['origin']): ResearchedSource => ({
  id,
  origin,
  outlet: `Outlet ${id}`,
  host: `outlet-${id.toLowerCase()}.example`,
  url: `https://outlet-${id.toLowerCase()}.example/a`,
  title: `Headline ${id}`,
  date: '2026-11-10',
  country: 'Kenya',
  kind: 'news-report',
  storyId: null,
  slug: null,
})

/** A researched version readers were given, citing the original and one search result. */
const research: ResearchedStory = {
  paragraphs: [
    {
      sentences: [
        {
          text: 'Researched paragraph.',
          citations: [
            { sourceId: 'S0', sentence: 'Of S0.' },
            { sourceId: 'S1', sentence: 'Of S1.' },
          ],
        },
      ],
    },
  ],
  whyThisMatters: [{ text: 'It matters.', citations: [{ sourceId: 'S1', sentence: 'Of S1.' }] }],
  caveats: [{ text: 'A caveat.', citations: [] }],
  quoteSourceId: null,
  sources: [source('S0', 'original'), source('S1', 'source')],
}

const passOf = (id: string) => prisma.researchPass.findUniqueOrThrow({ where: { id } })

async function spentThisMonth(usd: number) {
  await prisma.storyResearchRun.create({ data: { status: 'completed', trigger: 'editor', costUsd: usd, startedAt: new Date() } })
}

describeDb('research pass lifecycle (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    _setProcessStartedAt(ago(24 * 60))
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => _setProcessStartedAt(null))

  it('claims a first pass at its ceiling, and a later one for a story with a current version', async () => {
    const story = await researchable()
    const first = await claimPass(story.id, 'pipeline')
    expect(first).toMatchObject({ kind: 'first', ceilingUsd: FIRST })
    if (!('passId' in first)) throw new Error('refused')
    expect(await passOf(first.passId)).toMatchObject({ storyId: story.id, number: 1, trigger: 'pipeline', kind: 'first', status: 'running', costUsd: FIRST })

    expect(await claimPass(story.id, 'editor')).toEqual({ refused: 'in-progress' })

    // A first pass that kept no article leaves nothing to judge: the next is a first pass again
    await prisma.researchPass.update({ where: { id: first.passId }, data: { status: 'completed' } })
    const again = await claimPass(story.id, 'editor')
    expect(again).toMatchObject({ kind: 'first', ceilingUsd: FIRST })
    if (!('passId' in again)) throw new Error('refused')
    await prisma.researchPass.update({ where: { id: again.passId }, data: { status: 'completed' } })

    await prisma.articleVersion.create({
      data: { storyId: story.id, number: 1, kind: 'first', status: 'current', research: research as unknown as Prisma.InputJsonObject },
    })
    const later = await claimPass(story.id, 'editor')
    expect(later).toMatchObject({ kind: 'later', ceilingUsd: LATER })
    if (!('passId' in later)) throw new Error('refused')
    expect(await passOf(later.passId)).toMatchObject({ number: 3, trigger: 'editor', kind: 'later', costUsd: LATER })
  })

  it('claims a later pass for a story research already researched: the claim imports its legacy runs as version 1, once', async () => {
    const story = await researchable('published')
    await prisma.story.update({ where: { id: story.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    const claim = await claimPass(story.id, 'editor')
    expect(claim).toMatchObject({ kind: 'later', ceilingUsd: LATER })
    expect(await prisma.articleVersion.findMany({ where: { storyId: story.id }, select: { number: true, kind: true, status: true } })).toEqual([
      { number: 1, kind: 'legacy', status: 'current' },
    ])
    if (!('passId' in claim)) throw new Error('refused')
    await prisma.researchPass.update({ where: { id: claim.passId }, data: { status: 'completed' } })
    expect(await claimPass(story.id, 'editor')).toMatchObject({ kind: 'later' })
    expect(await prisma.articleVersion.count({ where: { storyId: story.id } })).toBe(1)
  })

  it('never passes the cap, however many claims start at once, research runs counted in the same month', async () => {
    // Room for exactly two first passes beside this month's research run
    await spentThisMonth(CAP - 2 * FIRST - 0.001)
    const stories = await Promise.all([1, 2, 3, 4].map(() => researchable()))

    const claims = await Promise.all(stories.map(s => claimPass(s.id, 'pipeline')))

    expect(claims.filter(c => 'passId' in c)).toHaveLength(2)
    expect(claims.filter(c => 'refused' in c && c.refused === 'cap')).toHaveLength(2)
    expect(await monthToDateUsd(prisma, new Date())).toBeLessThanOrEqual(CAP)
  })

  it("marks a pass a restart cut off failed, keeping its reservation, and leaves a live one running, a slow one past context's limit included", async () => {
    const story = await researchable()
    const cutOff = await prisma.researchPass.create({
      data: {
        storyId: story.id,
        number: 1,
        trigger: 'pipeline',
        kind: 'first',
        status: 'running',
        costUsd: FIRST,
        startedAt: ago(config.research.pass.staleRunMinutes + 5),
      },
    })
    const live = await prisma.researchPass.create({
      data: { storyId: story.id, number: 2, trigger: 'editor', kind: 'first', status: 'running', costUsd: FIRST, startedAt: ago(1) },
    })
    // A pass is research's and context's calls in turn, with a second attempt: it outlives a context run's limit
    const slow = await prisma.researchPass.create({
      data: {
        storyId: (await researchable()).id,
        number: 1,
        trigger: 'pipeline',
        kind: 'first',
        status: 'running',
        costUsd: FIRST,
        startedAt: ago(config.storyContext.staleRunMinutes + 5),
      },
    })

    expect(await markInterruptedPasses()).toBe(1)

    expect(await passOf(cutOff.id)).toMatchObject({ status: 'failed', outcome: 'technical', error: PASS_INTERRUPTED, costUsd: FIRST })
    expect((await passOf(cutOff.id)).finishedAt).not.toBeNull()
    expect(await passOf(live.id)).toMatchObject({ status: 'running' })
    expect(await passOf(slow.id)).toMatchObject({ status: 'running' })
  })

  it('records a skipped pass at $0 with its reason, numbered after the story’s others', async () => {
    const story = await researchable()
    await prisma.researchPass.create({ data: { storyId: story.id, number: 1, trigger: 'editor', kind: 'first', status: 'completed', costUsd: 0.2 } })

    const id = await recordSkippedPass(story.id, 'monthly cap reached')

    expect(await passOf(id)).toMatchObject({
      number: 2,
      trigger: 'pipeline',
      status: 'skipped',
      outcome: 'budget',
      costUsd: 0,
      error: 'skipped: monthly cap reached',
    })
  })
})
