import type { Prisma } from '@prisma/client'
import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import { createContextFact, createContextRun } from '../test/db/storyContext.js'
import { insertVersion } from './passRecords.js'
import { loadFirstPassInput, loadPassInput, passEligibility } from './researchPassInput.js'

// The loader's guarantees live in its SQL and in the reads it composes, so they are tested against
// PostgreSQL: the story as research loads it, the pool, the current version and its places, and the
// earlier stories' reusable facts.

const NOW = new Date('2026-11-16T01:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const assessed = { title: 'Assessed title', summary: 'Assessed summary.', relevance: 6 }

const research = {
  paragraphs: [{ sentences: [{ text: 'Floods displaced 4,000.', citations: [{ sourceId: 'S2', sentence: 'Sentence S2F1.' }] }] }],
  whyThisMatters: [],
  caveats: [],
  quoteSourceId: null,
  sources: [],
}

async function feed() {
  const issue = await createIssue()
  return (await createFeed(issue.id)).id
}

describeDb('loadPassInput', () => {
  useTestDatabase()

  it("loads a first pass's input: the story as research loads it, an empty pool, no version, its own places, and the earlier stories' current supported facts", async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'published', ...assessed, datePublished: ago(1) })
    const earlier = await createStory({ feedId, status: 'published', ...assessed, datePublished: ago(30) })
    for (const s of [story, earlier]) await setEmbedding(s.id, 0)
    const run = await createContextRun(earlier.id)
    const kept = await createContextFact(earlier.id, run.id, { ref: 'S2F1', validity: 'fixed' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F2', validity: 'fixed', verdict: 'rejected' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F3', validity: 'fixed', status: 'demoted' })

    const input = await loadPassInput(prisma, story.id, 'pass-1')
    expect(input).toMatchObject({
      passId: 'pass-1',
      story: { id: story.id, earlier: [{ id: earlier.id }] },
      pool: { sources: [], facts: [], searches: [], dropped: [] },
      version: null,
      current: { title: 'Assessed title', summary: 'Assessed summary.', layout: { paragraphs: [{ id: 'P1', text: 'Assessed summary.' }] } },
      storyDay: ago(1).toISOString().slice(0, 10),
    })
    expect(input!.reusable.map(o => [o.storyId, o.fact.id])).toEqual([[earlier.id, kept.id]])
  })

  it('reads a story with a current version as readers see it: its places from that version', async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'published', ...assessed, datePublished: ago(1) })
    await prisma.story.update({ where: { id: story.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    const versionId = await prisma.$transaction(tx =>
      insertVersion(tx, story.id, {
        id: null,
        number: 1,
        kind: 'legacy',
        status: 'current',
        passId: null,
        title: 'Version title',
        titleLabel: null,
        summary: 'Version summary.',
        marketingBlurb: null,
        quote: null,
        quoteAttribution: null,
        relevanceReasons: null,
        antifactors: null,
        emotionTag: null,
        research,
        changes: [],
        note: null,
      }),
    )

    const input = await loadPassInput(prisma, story.id, 'pass-2')
    expect(input?.version).toMatchObject({ id: versionId, kind: 'legacy', title: 'Version title' })
    expect(input?.current).toMatchObject({
      title: 'Version title',
      summary: 'Version summary.',
      layout: { paragraphs: [{ id: 'P1', text: 'Floods displaced 4,000.' }] },
    })

    // The eval's replay of a first pass reads no pass table: no version, the story's own columns
    const first = await loadFirstPassInput(prisma, story.id, 'eval')
    expect(first).toMatchObject({ version: null, pool: { sources: [], facts: [] }, current: { title: 'Assessed title', summary: 'Assessed summary.' } })
    expect(first?.current.layout.paragraphs.map(p => p.text)).toEqual(['Floods displaced 4,000.'])
  })

  it('dates a selected story about to be published at the time given', async () => {
    const feedId = await feed()
    const story = await createStory({ feedId, status: 'selected', ...assessed })
    expect((await loadPassInput(prisma, story.id, 'pass-3', NOW))?.storyDay).toBe('2026-11-16')
  })

  it('loads nothing for a story research cannot run on', async () => {
    const feedId = await feed()
    const fetched = await createStory({ feedId, status: 'fetched', ...assessed })
    const unrated = await createStory({ feedId, status: 'analyzed', ...assessed, relevance: null })
    expect(await loadPassInput(prisma, fetched.id, 'p')).toBeNull()
    expect(await loadPassInput(prisma, unrated.id, 'p')).toBeNull()
    expect(await loadPassInput(prisma, '00000000-0000-0000-0000-000000000000', 'p')).toBeNull()
  })
})

describeDb('passEligibility', () => {
  useTestDatabase()

  const pass = (storyId: string, status: 'running' | 'completed', number: number) =>
    prisma.researchPass.create({
      data: { storyId, number, trigger: 'editor', kind: 'first', status, outcome: status === 'running' ? null : 'fallback', costUsd: 0 },
    })

  it("says a story's status, whether a pass of it is running, and which kind of pass it would get", async () => {
    const feedId = await feed()
    const fresh = await createStory({ feedId, status: 'analyzed', ...assessed })
    const researched = await createStory({ feedId, status: 'published', ...assessed, datePublished: ago(2) })
    await prisma.story.update({ where: { id: researched.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    const running = await createStory({ feedId, status: 'selected', ...assessed })
    await pass(running.id, 'completed', 1)
    await pass(running.id, 'running', 2)

    expect(await passEligibility(prisma, fresh.id)).toEqual({ status: 'analyzed', running: false, kind: 'first' })
    // Researched before passes: the legacy import makes version 1, so the pass is a later one
    expect(await passEligibility(prisma, researched.id)).toEqual({ status: 'published', running: false, kind: 'later' })
    // A first pass that kept no article leaves nothing to judge: the next is a first pass again
    expect(await passEligibility(prisma, running.id)).toEqual({ status: 'selected', running: true, kind: 'first' })
    expect(await passEligibility(prisma, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
