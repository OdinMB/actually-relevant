import { it, expect } from 'vitest'
import prisma from '../../../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../../test/db/harness.js'
import { createResearchRun } from '../../../test/db/storyContext.js'
import { loadGapCandidates } from './gapDraft.js'

describeDb('gap-draft candidates', () => {
  useTestDatabase()

  it('gives no anchor and no candidates without a published story', async () => {
    expect(await loadGapCandidates(prisma)).toEqual({ anchor: null, candidates: [] })
  })

  it("takes the published stories of the 4 months up to the newest, each with a completed run's facts, under its top-level issue", async () => {
    const health = await createIssue({ slug: 'health' })
    const ebola = await createIssue({ slug: 'ebola', parentId: health.id })
    const climate = await createIssue({ slug: 'climate' })
    const feed = await createFeed(climate.id)
    const story = async (slug: string, datePublished: Date, extra: { status?: 'published' | 'selected'; issueId?: string; summary?: string } = {}) => {
      const s = await createStory({
        feedId: feed.id,
        status: extra.status ?? 'published',
        datePublished,
        slug,
        title: `Title ${slug}`,
        summary: extra.summary ?? null,
        issueId: extra.issueId ?? null,
      })
      return s
    }
    const withFacts = async (s: { id: string }, status: 'completed' | 'failed' = 'completed') =>
      createResearchRun(s.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { status })

    const newest = await story('newest', new Date('2026-11-14T09:00:00Z'), {
      issueId: ebola.id,
      summary: 'Fires burned 2.88 million hectares, 40 percent more than in 2015.',
    })
    await withFacts(newest)
    await withFacts(await story('in-window', new Date('2026-07-15T00:00:00Z'), { summary: 'Three villages left.' }))
    await withFacts(await story('too-old', new Date('2026-07-13T00:00:00Z')))
    await story('no-run', new Date('2026-11-10T00:00:00Z'))
    await createResearchRun((await story('no-facts', new Date('2026-11-10T00:00:00Z'))).id, [{ id: 'S0', facts: [] }])
    await withFacts(await story('failed-run', new Date('2026-11-10T00:00:00Z')), 'failed')
    await withFacts(await story('not-published', new Date('2026-12-01T00:00:00Z'), { status: 'selected' }))

    const { anchor, candidates } = await loadGapCandidates(prisma)
    expect(anchor).toBe('2026-11-14')
    expect(candidates.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { id: expect.any(String), slug: 'in-window', issue: 'climate', day: '2026-07-15', figures: 0 },
      { id: newest.id, slug: 'newest', issue: 'health', day: '2026-11-14', figures: 3 },
    ])
  })
})
