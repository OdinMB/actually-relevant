import { beforeEach, expect, it, vi } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, setEmbedding, useTestDatabase } from '../test/db/harness.js'
import type { PassWrite } from './passWrites.js'
import type { Pool, PoolFact, PoolSource } from './researchPool.js'

// Both gates open or closed together: the module is on only while both are open and its job enabled
const gate = vi.hoisted(() => ({ closed: 'closed for the test' as string | null }))
vi.mock('./overviewGate.js', () => ({
  get OVERVIEW_EVAL_GATE() {
    return gate.closed
  },
}))
vi.mock('./researchPassGate.js', () => ({
  get PASS_EVAL_GATE() {
    return gate.closed
  },
}))
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: vi.fn(),
  generateSearchEmbedding: vi.fn(async () => {
    throw new Error('no embeddings in this test')
  }),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
// The real caches, behind a spy: which ones a change empties
vi.mock('../lib/publicCaches.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/publicCaches.js')>()
  return { ...actual, clearPublicCaches: vi.fn(actual.clearPublicCaches) }
})

const { clearPublicCaches } = await import('../lib/publicCaches.js')
const { editorAction } = await import('./overviewLifecycle.js')
const { OVERVIEW_LINK_CACHES, overviewReport, publicOverview, publicOverviewHead, publicOverviewList, withOverview } = await import('./overviewPublic.js')
const { reviewDue } = await import('./overviewStatus.js')
const { overviewStates } = await import('./overviewUpkeepInput.js')
const { getHomepageData, getPublishedStories, getPublishedStoryBySlug } = await import('./publicStories.js')
const { getRelatedStories } = await import('./relatedStories.js')
const { storePassResult } = await import('./researchPassLifecycle.js')

const DAY = 86_400_000
const charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }

async function switchOn(on: boolean) {
  gate.closed = on ? null : 'closed for the test'
  await prisma.jobRun.upsert({
    where: { jobName: 'link_overviews' },
    create: { jobName: 'link_overviews', cronExpression: '30 1 * * *', enabled: on },
    update: { enabled: on },
  })
}

let seq = 0
async function stories(n: number, issueSlug?: string) {
  const issue = await createIssue(issueSlug ? { slug: issueSlug } : {})
  const feed = await createFeed(issue.id)
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      createStory({
        feedId: feed.id,
        issueId: issue.id,
        status: 'published',
        slug: `story-${++seq}`,
        title: `Story ${seq}`,
        emotionTag: 'calm',
        datePublished: new Date(Date.now() - (n - i) * DAY),
      }),
    ),
  )
}

async function overview(storyIds: string[], over: Partial<{ scope: 'single' | 'forming' | 'ongoing'; hidden: boolean; slug: string | null }> = {}) {
  const o = await prisma.overview.create({
    data: {
      title: 'Ebola in Ituri',
      slug: `ebola-${++seq}`,
      charter,
      charterModel: 'gpt-6.1-sol',
      charterPromptVersion: 'v',
      foundedAt: new Date(Date.now() - 30 * DAY),
      lastEntryAt: new Date(Date.now() - DAY),
      scope: 'ongoing',
      ...over,
    },
  })
  for (const [i, storyId] of storyIds.entries())
    await prisma.overviewEntry.create({
      data: { overviewId: o.id, storyId, role: i === 0 ? 'turning_point' : 'routine', roleKind: i === 0 ? 'response' : null, joinedBy: 'pipeline' },
    })
  return o
}

const source = (ref: string): PoolSource => ({
  id: null,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url: `https://${ref.toLowerCase()}.example/report`,
  outlet: `Outlet ${ref}`,
  title: `Title ${ref}`,
  date: '2026-11-12',
  kind: 'news-report',
  country: 'DR Congo',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: null,
})

const structured = {
  value: 212,
  valueHigh: null,
  unit: 'people',
  approx: 'exact' as const,
  provisional: false,
  counted: 'deaths',
  place: 'Ituri',
  asOf: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
  credited: 'WHO',
  creditedKind: 'official' as const,
  validity: 'slow' as const,
  by: { model: 'test-small', promptVersion: 'str00001' },
}

/** A first pass's pool for the story: sources S1 and S2, one supported structured fact each, by row id. */
async function pool(storyId: string): Promise<Map<string, string>> {
  const pass = await prisma.researchPass.create({ data: { storyId, number: 1, trigger: 'pipeline', kind: 'first', costUsd: 0.4 }, select: { id: true } })
  const fact = (ref: string): PoolFact => ({
    id: null,
    ref,
    sourceRef: ref.replace(/F\d+$/, ''),
    reusedFromId: null,
    supportingSentence: `Sentence of ${ref}.`,
    passage: null,
    supportFound: true,
    statement: `Statement of ${ref}.`,
    measures: '',
    slot: null,
    structured,
    extractedBy: { model: 'test-small', promptVersion: 'ext00001' },
    verdict: 'supported',
    verdictProblem: null,
    checkedBy: { model: 'm', promptVersion: 'v', passId: pass.id },
    status: 'unreviewed',
    firstPassId: null,
    drop: null,
  })
  const p: Pool = { sources: [source('S1'), source('S2')], facts: [fact('S1F1'), fact('S2F1')], searches: [], dropped: [] }
  const write: PassWrite = {
    storyId,
    passId: pass.id,
    pool: p,
    changed: [],
    version: null,
    boxes: [],
    boxFacts: new Map(),
    writer: null,
    pass: { status: 'completed', outcome: 'written', verdict: 'keep', modelUsd: 0.1, credits: 4, costUsd: 0.132, record: { steps: 1 }, error: null },
    now: new Date(),
  }
  await prisma.$transaction(tx => storePassResult(tx, write))
  const rows = await prisma.poolFact.findMany({ where: { storyId }, select: { id: true, ref: true } })
  return new Map(rows.map(r => [r.ref, r.id]))
}

describeDb('public overviews (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => vi.mocked(clearPublicCaches).mockClear())

  it('serves nothing while the module is off: no field, no page, no list, no preview', async () => {
    await switchOn(false)
    const [a, b, c] = await stories(3)
    const o = await overview([a!.id, b!.id, c!.id])
    expect((await withOverview([a!])).map(s => s.overview)).toEqual([null])
    expect(await publicOverview(o.slug!)).toBeNull()
    expect(await publicOverviewHead(o.slug!)).toBeNull()
    expect(await publicOverviewList()).toEqual({ on: false, overviews: [] })
    expect(await overviewReport(o.id)).toBeNull()

    // On, but the gates closed again: still nothing
    await switchOn(true)
    gate.closed = 'closed again'
    expect((await withOverview([a!]))[0]!.overview).toBeNull()
  })

  it('sets the field only for a story in an ongoing overview that is not hidden, on every public story path', async () => {
    await switchOn(true)
    const [a, b, c, d, e, f, g] = await stories(7, 'planet-climate')
    const pub = await overview([a!.id, b!.id, c!.id])
    await overview([d!.id, e!.id], { scope: 'forming', slug: null })
    await overview([f!.id], { scope: 'single', slug: null })
    await overview([g!.id], { hidden: true })
    const link = { slug: pub.slug, title: 'Ebola in Ituri' }

    const linked = await withOverview([a!, d!, f!, g!])
    expect(linked.map(s => s.overview)).toEqual([link, null, null, null])

    const list = await getPublishedStories({ pageSize: 25 })
    expect(new Map(list.data.map(s => [s.id, s.overview]))).toEqual(new Map([a, b, c, d, e, f, g].map(s => [s!.id, [a, b, c].includes(s) ? link : null])))
    const searched = await getPublishedStories({ search: 'Story' })
    expect(searched.data.find(s => s.id === a!.id)?.overview).toEqual(link)
    expect((await getPublishedStoryBySlug(a!.slug!))?.overview).toEqual(link)
    expect((await getPublishedStoryBySlug(d!.slug!))?.overview).toBeNull()
    const home = await getHomepageData(['planet-climate'])
    expect(home.storiesByIssue['planet-climate']!.calm.find(s => s.id === b!.id)?.overview).toEqual(link)

    await setEmbedding(d!.id, 0)
    await setEmbedding(a!.id, 1)
    expect((await getRelatedStories(d!.slug!)).find(s => s.id === a!.id)?.overview).toEqual(link)
  })

  it('serves the page: header, timeline newest first with roles and Updates, and the stands as served now with their sources', async () => {
    await switchOn(true)
    const [a, b, c] = await stories(3)
    const o = await overview([a!.id, b!.id, c!.id])
    const facts = await pool(c!.id)
    await prisma.articleVersion.create({
      data: {
        storyId: c!.id,
        number: 2,
        kind: 'update',
        status: 'current',
        research: { paragraphs: [], whyThisMatters: [], caveats: [], quoteSourceId: null, sources: [] },
        changes: [],
        note: { text: 'Officials revised the count.', citations: [] },
      },
    })
    await prisma.overviewStands.create({
      data: {
        overviewId: o.id,
        number: 1,
        sentences: [
          { text: 'Deaths reached 212.', facts: [facts.get('S1F1'), facts.get('S2F1')] },
          { text: 'A fact gone since.', facts: ['no-such-fact'] },
        ],
        doing: [{ text: 'Vaccination goes on.', facts: [facts.get('S2F1')] }],
        asOf: new Date(),
        model: 'gpt-6-luna',
        promptVersion: 'v',
      },
    })

    const page = await publicOverview(o.slug!)
    expect(page).toMatchObject({ slug: o.slug, title: 'Ebola in Ituri', status: 'open', stories: 3, closedReason: null })
    expect(page!.entries.map(e => e.slug)).toEqual([c!.slug, b!.slug, a!.slug])
    expect(page!.entries[2]).toMatchObject({ role: 'turning_point', roleKind: 'response' })
    expect(page!.entries[0]!.updates).toEqual([{ date: expect.any(String), note: 'Officials revised the count.' }])
    expect(page!.stands!.sentences).toEqual([
      {
        text: 'Deaths reached 212.',
        citations: [
          { sourceId: 'S1', sentence: 'Sentence of S1F1.' },
          { sourceId: 'S2', sentence: 'Sentence of S2F1.' },
        ],
      },
    ])
    expect(page!.stands!.doing).toEqual([{ text: 'Vaccination goes on.', citations: [{ sourceId: 'S2', sentence: 'Sentence of S2F1.' }] }])
    expect(page!.sources.map(s => [s.id, s.outlet, s.host, s.via])).toEqual([
      ['S1', 'Outlet S1', 's1.example', { slug: c!.slug, title: c!.title }],
      ['S2', 'Outlet S2', 's2.example', { slug: c!.slug, title: c!.title }],
    ])
    expect(page!.aiGenerated).toMatchObject({ fields: ['title', 'stands', 'entries'], models: ['gpt-6.1-sol', 'gpt-6-luna'] })

    // An unpublished member leaves the page before the job runs, with the lines only its facts cite
    await prisma.story.update({ where: { id: c!.id }, data: { status: 'rejected' } })
    const after = await publicOverview(o.slug!)
    expect(after!.entries.map(e => e.slug)).toEqual([b!.slug, a!.slug])
    expect(after!.stands).toBeNull()
    expect(after!.aiGenerated.fields).toEqual(['title', 'entries'])
  })

  it('answers no page for an overview that is not public, and lists the public ones most recently changed first', async () => {
    await switchOn(true)
    const [a, b, c, d, e, f] = await stories(6)
    const older = await overview([a!.id, b!.id], { slug: 'older' })
    await prisma.overview.update({ where: { id: older.id }, data: { lastEntryAt: new Date(Date.now() - 10 * DAY) } })
    const newer = await overview([c!.id, d!.id], { slug: 'newer' })
    const forming = await overview([e!.id, f!.id], { scope: 'forming', slug: 'forming' })
    expect(await publicOverview(forming.slug!)).toBeNull()
    await prisma.overview.update({ where: { id: newer.id }, data: { hidden: true } })
    expect(await publicOverview('newer')).toBeNull()
    await prisma.overview.update({ where: { id: newer.id }, data: { hidden: false } })

    const list = await publicOverviewList()
    expect(list.on).toBe(true)
    expect(list.overviews.map(o => [o.slug, o.stories])).toEqual([
      ['newer', 2],
      ['older', 2],
    ])
  })

  it('queues one review for a reader’s reports within 7 days, which the job then owes', async () => {
    await switchOn(true)
    const [a, b, c] = await stories(3)
    const o = await overview([a!.id, b!.id, c!.id])
    await prisma.overview.update({ where: { id: o.id }, data: { reviewedAt: new Date(Date.now() - 2 * DAY), entriesAtLastReview: 3 } })
    const report = async (queuesReview: boolean, createdAt = new Date()) =>
      prisma.feedback.create({ data: { category: 'correction', message: 'x', ipHash: 'h', overviewId: o.id, queuesReview, createdAt } })

    expect(await overviewReport(o.id)).toEqual({ queuesReview: true })
    await report(true)
    expect(await overviewReport(o.id)).toEqual({ queuesReview: false })
    await report(false)
    const [state] = await overviewStates(prisma, new Date())
    expect(reviewDue(state!, { clock: new Date(), now: new Date() })).toBe('report')

    // A review after it answers it; 7 days after the queued one, a report queues again
    await prisma.overview.update({ where: { id: o.id }, data: { reviewedAt: new Date() } })
    const [reviewed] = await overviewStates(prisma, new Date())
    expect(reviewDue(reviewed!, { clock: new Date(), now: new Date() })).toBeNull()
    await prisma.feedback.updateMany({ where: { overviewId: o.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    expect(await overviewReport(o.id)).toEqual({ queuesReview: true })

    const hidden = await overview([], { hidden: true })
    expect(await overviewReport(hidden.id)).toBeNull()
  })

  it('empties the caches that hold links when an editor hides a public overview or detaches its story, not when it unhides', async () => {
    await switchOn(true)
    const [a, b, c] = await stories(3)
    const o = await overview([a!.id, b!.id, c!.id])
    await editorAction({ kind: 'hide', overviewId: o.id, hidden: true }, 'editor-1')
    expect(vi.mocked(clearPublicCaches)).toHaveBeenCalledWith(OVERVIEW_LINK_CACHES)
    vi.mocked(clearPublicCaches).mockClear()
    await editorAction({ kind: 'hide', overviewId: o.id, hidden: false }, 'editor-1')
    expect(vi.mocked(clearPublicCaches)).not.toHaveBeenCalled()
    const entry = await prisma.overviewEntry.findFirstOrThrow({ where: { storyId: a!.id } })
    await editorAction({ kind: 'detach', overviewId: o.id, entryId: entry.id }, 'editor-1')
    expect(vi.mocked(clearPublicCaches)).toHaveBeenCalledWith(OVERVIEW_LINK_CACHES)
    expect((await withOverview([a!]))[0]!.overview).toBeNull()
  })
})
