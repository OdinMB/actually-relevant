/**
 * The eval copy against PostgreSQL: an export of every story (`--all`) through the read-only session
 * holds every exported table's rows, its person-naming values scrubbed, and nothing of the tables left
 * out; an import into the same (test) database empties it and gives back the same rows, vectors bit
 * for bit. A windowed export holds the stories first seen in its window and every story its rows
 * point at, none of an older story's rows, and imports with every foreign key in place. An import of
 * a copy it must refuse leaves the database as it was.
 */
import { afterAll, beforeAll, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import prisma from '../../lib/prisma.js'
import { createCluster, createFeed, createIssue, createNewsletter, createStory, describeDb, monthsAgo, useTestDatabase } from '../../test/db/harness.js'
import { createPass, createPassBox, createPoolFact, createPoolSource } from '../../test/db/passes.js'
import { createContextBox, createContextFact, createContextRun, createResearchRun } from '../../test/db/storyContext.js'
import { readPrismaSchema } from '../../test/prismaSchema.js'
import { openReadOnlyDb } from '../eval/readOnlyDb.js'
import { headerLine, rowLine, trailerLine } from './copyFile.js'
import { exportEvalCopy } from './exportCopy.js'
import { importEvalCopy } from './importCopy.js'
import { foreignKeys } from './references.js'
import { EXPORTED_TABLES } from './tables.js'
import { copyWindow } from './window.js'

const EDITOR_ID = '6f1c2b8e-1d3a-4c55-9a7e-0b2f4d6a8c10'
const EDITOR_EMAIL = 'editor.person@example.org'
const READER_EMAIL = 'reader.person@example.org'
const SUBSCRIBER_EMAIL = 'subscriber.person@example.org'
const SECRETS = [EDITOR_ID, EDITOR_EMAIL, READER_EMAIL, SUBSCRIBER_EMAIL, 'Editor Person', 'hash-secret', 'refresh-secret', 'sub-token-secret']

/** A 1536-dimension vector of values that use a float4's full precision. */
const vectorLiteral = (seed: number) => `[${Array.from({ length: 1536 }, (_, i) => Math.sin((i + 1) * seed) / 3).join(',')}]`

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'eval-copy-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Every exported table's rows as Prisma reads them, by table. */
const snapshot = async () => ({
  issues: await prisma.issue.findMany({ orderBy: { id: 'asc' } }),
  feeds: await prisma.feed.findMany({ orderBy: { id: 'asc' } }),
  stories: await prisma.story.findMany({ orderBy: { id: 'asc' } }),
  story_embeddings: await prisma.storyEmbedding.findMany({ orderBy: { storyId: 'asc' } }),
  story_clusters: await prisma.storyCluster.findMany({ orderBy: { id: 'asc' } }),
  story_research_runs: await prisma.storyResearchRun.findMany({ orderBy: { id: 'asc' } }),
  story_context_runs: await prisma.storyContextRun.findMany({ orderBy: { id: 'asc' } }),
  context_facts: await prisma.contextFact.findMany({ orderBy: { id: 'asc' } }),
  context_boxes: await prisma.contextBox.findMany({ orderBy: { id: 'asc' } }),
  context_search_cache: await prisma.contextSearchCache.findMany({ orderBy: { key: 'asc' } }),
  research_passes: await prisma.researchPass.findMany({ orderBy: { id: 'asc' } }),
  article_versions: await prisma.articleVersion.findMany({ orderBy: { id: 'asc' } }),
  evidence_searches: await prisma.evidenceSearch.findMany({ orderBy: { id: 'asc' } }),
  evidence_sources: await prisma.evidenceSource.findMany({ orderBy: { id: 'asc' } }),
  pool_facts: await prisma.poolFact.findMany({ orderBy: { id: 'asc' } }),
  pass_boxes: await prisma.passBox.findMany({ orderBy: { id: 'asc' } }),
  overviews: await prisma.overview.findMany({ orderBy: { id: 'asc' } }),
  overview_decisions: await prisma.overviewDecision.findMany({ orderBy: { id: 'asc' } }),
  overview_entries: await prisma.overviewEntry.findMany({ orderBy: { id: 'asc' } }),
  overview_stands: await prisma.overviewStands.findMany({ orderBy: { id: 'asc' } }),
})

/** Each stored vector's binary form, hashed: equal only when every float is. */
const vectorFingerprints = () =>
  prisma.$queryRaw<{ story_id: string; fp: string }[]>`SELECT story_id, md5(vector_send(embedding)) AS fp FROM story_embeddings ORDER BY story_id`

const excludedCounts = async () => ({
  users: await prisma.user.count(),
  refreshTokens: await prisma.refreshToken.count(),
  feedback: await prisma.feedback.count(),
  adminNotices: await prisma.adminNotice.count(),
  newsletters: await prisma.newsletter.count(),
  jobRuns: await prisma.jobRun.count(),
  pendingSubscriptions: await prisma.pendingSubscription.count(),
  blueskyPosts: await prisma.blueskyPost.count(),
})

/** A row in every exported table, cycles of foreign keys included, and in some tables left out. */
async function fillDatabase() {
  const parent = await createIssue({ slug: 'parent' })
  const child = await createIssue({ slug: 'child', parentId: parent.id })
  const feed = await createFeed(child.id)
  const a = await createStory({
    feedId: feed.id,
    status: 'published',
    slug: 'a-story',
    title: 'A',
    summary: 'S',
    relevance: 7,
    datePublished: new Date('2026-11-20T08:30:00.123Z'),
    issueId: child.id,
    emotionTag: 'calm',
  })
  await prisma.story.update({
    where: { id: a.id },
    data: { quoteAttribution: 'A named minister', research: { sections: [{ text: 'Researched.', citations: ['S0F1'] }] } },
  })
  const b = await createStory({ feedId: feed.id, status: 'rejected', rejectionReason: 'duplicate' })
  await createCluster([a.id, b.id], a.id)
  // Older than any window: `--all` copies it all the same
  const old = await createStory({ feedId: feed.id, status: 'published', dateCrawled: monthsAgo(30) })
  await createResearchRun(old.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
  await prisma.$executeRaw`INSERT INTO story_embeddings (story_id, embedding, content_hash) VALUES (${a.id}, ${vectorLiteral(7.3)}::vector, 'hash-a'), (${b.id}, ${vectorLiteral(2.9)}::vector, 'hash-b'), (${old.id}, ${vectorLiteral(5.1)}::vector, 'hash-old')`

  const research = await createResearchRun(a.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
  const contextRun = await createContextRun(a.id, { researchRunId: research.id, costUsd: 0.1 + 0.2, result: { gaps: ['compared'] } })
  await createContextFact(a.id, contextRun.id, { ref: 'C1F1', value: 1 / 3, asOf: new Date('2026-11-01T00:00:00Z') })
  await createContextBox(a.id, contextRun.id, { position: 1, sentences: [{ text: 'A card.', factIds: ['C1F1'] }], visual: { kind: 'tiles', tiles: [] } })
  await prisma.contextSearchCache.create({ data: { key: 'cache-key', query: 'a query', results: [{ url: 'https://x.example/a', title: 'X' }], credits: 2 } })

  const pass = await createPass(a.id, 1, { record: { steps: ['search', 'write'] } })
  const version = await prisma.articleVersion.create({
    data: { storyId: a.id, number: 1, passId: pass.id, kind: 'first', research: { sections: [] }, changes: [] },
  })
  await prisma.researchPass.update({ where: { id: pass.id }, data: { versionId: version.id } })
  await prisma.evidenceSearch.create({
    data: {
      storyId: a.id,
      passId: pass.id,
      kind: 'coverage',
      query: 'q',
      normalizedQuery: 'q',
      windowStart: new Date('2026-11-01T00:00:00Z'),
      credits: 1,
      results: 3,
    },
  })
  const source = await createPoolSource(a.id, 'S0', { firstPassId: pass.id, voices: [{ name: 'A named minister', role: 'minister', quote: 'We act.' }] })
  const fact = await createPoolFact(source, { ref: 'S0F1', firstPassId: pass.id, contradictedBy: ['S1F2'], asOf: new Date('2026-11-02T00:00:00Z') })
  await createPassBox(a.id, pass.id, { position: 1 })

  const overview = await prisma.overview.create({
    data: {
      title: 'A development',
      issueId: child.id,
      scope: 'ongoing',
      charter: { in: 'The development.', out: [], endEvent: null },
      charterModel: 'test-model',
      charterPromptVersion: 'chr00001',
      foundedAt: new Date('2026-11-20T00:00:00Z'),
      frozen: true,
      frozenBy: 'burst',
      recenteredAt: new Date('2026-11-21T00:00:00Z'),
      recenteredBy: EDITOR_EMAIL,
      lockedOut: ['An unrelated story'],
    },
  })
  const detach = await prisma.overviewDecision.create({
    data: {
      kind: 'editor_detach',
      outcome: 'detached',
      overviewId: overview.id,
      storyId: a.id,
      inputs: {
        target: null,
        changes: [{ table: 'entry', id: 'e1', before: { status: 'active', detachedBy: null }, after: { status: 'detached', detachedBy: EDITOR_ID } }],
      },
      actor: EDITOR_ID,
      undoneAt: new Date('2026-11-22T00:00:00Z'),
      undoneBy: EDITOR_ID,
    },
  })
  await prisma.overviewDecision.create({
    data: {
      kind: 'link',
      outcome: 'joined',
      overviewId: overview.id,
      storyId: a.id,
      inputs: { candidates: [{ id: overview.id, distance: 0.2 }] },
      answer: { yes: true },
      confidence: 0.9,
      costUsd: 0.0123,
      actor: 'pipeline',
    },
  })
  await prisma.overviewEntry.create({
    data: {
      overviewId: overview.id,
      storyId: a.id,
      role: 'routine',
      status: 'detached',
      joinedBy: 'pipeline',
      detachedBy: EDITOR_ID,
      detachReason: 'editor',
      locked: true,
      decisionId: detach.id,
      detachedAt: new Date(),
    },
  })
  await prisma.overviewStands.create({
    data: {
      overviewId: overview.id,
      number: 1,
      sentences: [{ text: 'Where it stands.', facts: [fact.id] }],
      asOf: new Date('2026-11-03T00:00:00Z'),
      model: 'test-model',
      promptVersion: 'std00001',
    },
  })

  // Tables the copy leaves out, holding a person's details
  await prisma.user.create({ data: { id: EDITOR_ID, email: EDITOR_EMAIL, name: 'Editor Person', passwordHash: 'hash-secret', role: 'editor' } })
  await prisma.refreshToken.create({ data: { token: 'refresh-secret', userId: EDITOR_ID, familyId: 'family', expiresAt: new Date('2027-01-01T00:00:00Z') } })
  await prisma.feedback.create({
    data: { category: 'correction', message: 'A wrong figure', email: READER_EMAIL, ipHash: 'ip-hash', storyId: a.id, overviewId: overview.id },
  })
  await prisma.adminNotice.create({ data: { source: 'job', severity: 'error', title: 'A notice', message: 'Something failed' } })
  await createNewsletter({ storyIds: [a.id] })
  await prisma.jobRun.create({ data: { jobName: 'crawl_feeds', cronExpression: '0 * * * *', lockedBy: EDITOR_ID } })
  await prisma.pendingSubscription.create({ data: { email: SUBSCRIBER_EMAIL, token: 'sub-token-secret', expiresAt: new Date('2027-01-01T00:00:00Z') } })
  await prisma.blueskyPost.create({ data: { storyId: a.id, postText: 'A post' } })
  return { detachId: detach.id }
}

/** A row in every table a story owns: its embedding, research and context runs, and a research pass with its pool. */
async function giveRows(storyId: string, seed: number): Promise<void> {
  await prisma.$executeRaw`INSERT INTO story_embeddings (story_id, embedding, content_hash) VALUES (${storyId}, ${vectorLiteral(seed)}::vector, ${`hash-${seed}`})`
  const research = await createResearchRun(storyId, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
  const run = await createContextRun(storyId, { researchRunId: research.id })
  await createContextFact(storyId, run.id, { ref: 'C1F1' })
  await createContextBox(storyId, run.id, { position: 1 })
  const pass = await createPass(storyId, 1)
  const version = await prisma.articleVersion.create({ data: { storyId, number: 1, passId: pass.id, kind: 'first', research: { sections: [] }, changes: [] } })
  await prisma.researchPass.update({ where: { id: pass.id }, data: { versionId: version.id } })
  await prisma.evidenceSearch.create({ data: { storyId, passId: pass.id, kind: 'coverage', query: 'q', normalizedQuery: 'q' } })
  const source = await createPoolSource(storyId, 'S0', { firstPassId: pass.id })
  await createPoolFact(source, { ref: 'S0F1', firstPassId: pass.id })
  await createPassBox(storyId, pass.id, { position: 1 })
}

const createOverview = (issueId: string, title: string) =>
  prisma.overview.create({
    data: {
      title,
      issueId,
      scope: 'ongoing',
      charter: { in: title, out: [], endEvent: null },
      charterModel: 'test-model',
      charterPromptVersion: 'chr00001',
      foundedAt: new Date('2026-11-20T00:00:00Z'),
    },
  })
const createLinkDecision = (overviewId: string | null, storyId: string, outcome: string) =>
  prisma.overviewDecision.create({ data: { kind: 'link', outcome, overviewId, storyId, actor: 'pipeline' } })
async function createMember(overviewId: string, storyId: string): Promise<void> {
  const decision = await createLinkDecision(overviewId, storyId, 'joined')
  await prisma.overviewEntry.create({ data: { overviewId, storyId, role: 'routine', joinedBy: 'pipeline', decisionId: decision.id } })
}
const createStands = (overviewId: string) =>
  prisma.overviewStands.create({
    data: { overviewId, number: 1, sentences: [], asOf: new Date('2026-11-03T00:00:00Z'), model: 'test-model', promptVersion: 'std00001' },
  })

/** Export with a six-month window through the read-only session. */
async function exportWindow(file: string, now: Date) {
  const session = await openReadOnlyDb()
  return exportEvalCopy(session, file, { window: 6, now }).finally(() => session.close())
}

describeDb('the eval copy (PostgreSQL)', () => {
  useTestDatabase()

  it('--all: exports every row of every exported table scrubbed and none left out, and an import gives the same rows back, vectors bit for bit', async () => {
    const { detachId } = await fillDatabase()
    const before = await snapshot()
    const fingerprints = await vectorFingerprints()
    // Every exported table holds a row, so each one's round trip is tested
    expect(Object.keys(before).sort()).toEqual(EXPORTED_TABLES.map(t => t.table).sort())
    for (const [table, rows] of Object.entries(before)) expect(rows.length, table).toBeGreaterThan(0)

    const file = join(dir, 'copy.jsonl.gz')
    const session = await openReadOnlyDb()
    const summary = await exportEvalCopy(session, file, { window: 'all' }).finally(() => session.close())

    // No person's details anywhere in the file, and no table but the exported ones
    const text = gunzipSync(readFileSync(file)).toString('utf8')
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    const lines = text.trimEnd().split('\n')
    expect((JSON.parse(lines[0]!) as { window: unknown }).window).toBe('all')
    expect([...new Set(lines.slice(1, -1).map(l => (JSON.parse(l) as { table: string }).table))]).toEqual(EXPORTED_TABLES.map(t => t.table))
    expect(summary.window).toBe('all')
    expect(summary.inWindow).toBeNull()
    expect(summary.nulled).toEqual({})
    expect(summary.counts).toEqual(Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])))
    expect(summary.scrubbed).toEqual({
      'overviews.recentered_by': 1,
      'overview_decisions.actor': 1,
      'overview_decisions.undone_by': 1,
      'overview_decisions.inputs': 1,
      'overview_entries.detached_by': 1,
    })

    // The import empties the database first: this issue is not in the copy
    await createIssue({ slug: 'not-in-the-copy' })
    const imported = await importEvalCopy(prisma, file)
    expect(imported.counts).toEqual(summary.counts)
    expect(imported.window).toBe('all')

    expect(await snapshot()).toEqual({
      ...before,
      overviews: before.overviews.map(o => ({ ...o, recenteredBy: 'editor' })),
      overview_entries: before.overview_entries.map(e => ({ ...e, detachedBy: 'editor' })),
      overview_decisions: before.overview_decisions.map(d =>
        d.id === detachId
          ? {
              ...d,
              actor: 'editor',
              undoneBy: 'editor',
              inputs: {
                target: null,
                changes: [{ table: 'entry', id: 'e1', before: { status: 'active', detachedBy: null }, after: { status: 'detached', detachedBy: 'editor' } }],
              },
            }
          : d,
      ),
    })
    expect(await vectorFingerprints()).toEqual(fingerprints)
    expect(await excludedCounts()).toEqual({
      users: 0,
      refreshTokens: 0,
      feedback: 0,
      adminNotices: 0,
      newsletters: 0,
      jobRuns: 0,
      pendingSubscriptions: 0,
      blueskyPosts: 0,
    })
  })

  it('refuses a copy holding a table off the list, one cut short, and one with a column the database lacks, and leaves the database as it was', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id })
    const header = headerLine({ exportedAt: new Date().toISOString(), migration: null, window: 'all' })
    const write = (name: string, content: Buffer) => {
      const path = join(dir, name)
      writeFileSync(path, content)
      return path
    }
    const copy = (name: string, lines: string[]) => write(name, gzipSync(`${lines.join('\n')}\n`))

    // A row the import would load: the refusals below come from the copy, not the row
    const issueRow = { id: 'i9', name: 'x', slug: 'x', updated_at: '2026-11-26T12:00:00' }

    const users = copy('users.jsonl.gz', [
      header,
      rowLine('issues', issueRow),
      rowLine('users', { id: 'u1', email: READER_EMAIL }),
      trailerLine({ issues: 1, users: 1 }),
    ])
    await expect(importEvalCopy(prisma, users)).rejects.toThrow(/table "users", which is not one the copy may hold/)
    await expect(importEvalCopy(prisma, copy('short.jsonl.gz', [header, rowLine('issues', issueRow)]))).rejects.toThrow(/cut short/)
    const extra = copy('column.jsonl.gz', [header, rowLine('issues', { ...issueRow, approved_by: 'someone' }), trailerLine({ issues: 1 })])
    await expect(importEvalCopy(prisma, extra)).rejects.toThrow(/issues\.approved_by/)
    const whole = gzipSync(`${[header, rowLine('issues', issueRow), trailerLine({ issues: 1 })].join('\n')}\n`)
    await expect(importEvalCopy(prisma, write('broken.jsonl.gz', whole.subarray(0, whole.length - 12)))).rejects.toThrow(/unexpected end of file/)

    expect(await prisma.story.findMany({ select: { id: true } })).toEqual([{ id: story.id }])
    expect(await prisma.issue.count()).toBe(1)
  })

  it('a windowed copy holds the stories first seen in the window and every story its rows point at, none of an older story, and imports with every foreign key in place', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const OLD = monthsAgo(8)
    const story = (dateCrawled?: Date) => createStory({ feedId: feed.id, dateCrawled })

    // In the window, with a row in every table a story owns
    const recent = await story()
    await giveRows(recent.id, 1)
    // Older, with the same rows, and pointed at by nothing in the window: none of it is copied
    const old = await story(OLD)
    await giveRows(old.id, 2)

    // A cluster with a recent member, an old primary and an old member: all three are kept
    const member = await story()
    const primary = await story(OLD)
    await giveRows(primary.id, 3)
    const oldMember = await story(OLD)
    const cluster = await createCluster([member.id, primary.id, oldMember.id], primary.id)
    // A cluster of old stories only: left out
    const oldA = await story(OLD)
    const oldB = await story(OLD)
    await createCluster([oldA.id, oldB.id], oldA.id)

    // An overview with a recent story and an old one, and its decision about another old story it turned away
    const inOverview = await story()
    const oldInOverview = await story(OLD)
    await giveRows(oldInOverview.id, 4)
    const turnedAway = await story(OLD)
    const overview = await createOverview(issue.id, 'Kept')
    await createMember(overview.id, inOverview.id)
    await createMember(overview.id, oldInOverview.id)
    await createLinkDecision(overview.id, turnedAway.id, 'rejected')
    await createStands(overview.id)
    // An overview of old stories only: left out, with its entries, stands and decisions
    const oldOnly = await story(OLD)
    const oldOverview = await createOverview(issue.id, 'Left out')
    await createMember(oldOverview.id, oldOnly.id)
    await createStands(oldOverview.id)
    // A recent story's link decision that found no overview: kept with its story
    await createLinkDecision(null, recent.id, 'none')

    // A recent story's pool fact on an old story's source (rows that disagree on their story): that story is kept
    const elsewhere = await story(OLD)
    const elsewhereSource = await createPoolSource(elsewhere.id, 'S0')
    await createPoolFact(elsewhereSource, { ref: 'S1F1', storyId: recent.id })
    // A recent story's context run on a research run whose story is gone: the link is written as null
    const orphanRun = await prisma.storyResearchRun.create({ data: { storyId: null, status: 'completed', costUsd: 0.1 } })
    const onOrphan = await createContextRun(recent.id, { researchRunId: orphanRun.id })
    // The search cache: an entry made in the window is kept, an older one is not
    await prisma.contextSearchCache.create({ data: { key: 'recent', query: 'q', results: [], credits: 1 } })
    await prisma.contextSearchCache.create({ data: { key: 'old', query: 'q', results: [], credits: 1, createdAt: OLD } })

    const kept = new Set([recent, member, primary, oldMember, inOverview, oldInOverview, turnedAway, elsewhere].map(s => s.id))
    const before = await snapshot()
    const byStory = <T extends { storyId: string | null }>(rows: T[]) => rows.filter(r => r.storyId !== null && kept.has(r.storyId))
    const expected = {
      ...before,
      stories: before.stories.filter(s => kept.has(s.id)),
      story_embeddings: byStory(before.story_embeddings),
      story_clusters: before.story_clusters.filter(c => c.id === cluster),
      story_research_runs: byStory(before.story_research_runs),
      story_context_runs: byStory(before.story_context_runs).map(r => (r.id === onOrphan.id ? { ...r, researchRunId: null } : r)),
      context_facts: byStory(before.context_facts),
      context_boxes: byStory(before.context_boxes),
      context_search_cache: before.context_search_cache.filter(c => c.key === 'recent'),
      research_passes: byStory(before.research_passes),
      article_versions: byStory(before.article_versions),
      evidence_searches: byStory(before.evidence_searches),
      evidence_sources: byStory(before.evidence_sources),
      pool_facts: byStory(before.pool_facts),
      pass_boxes: byStory(before.pass_boxes),
      overviews: before.overviews.filter(o => o.id === overview.id),
      overview_decisions: before.overview_decisions.filter(d => d.overviewId === overview.id || (d.overviewId === null && d.storyId === recent.id)),
      overview_entries: before.overview_entries.filter(e => e.overviewId === overview.id),
      overview_stands: before.overview_stands.filter(s => s.overviewId === overview.id),
    }
    // Every table a story owns had a row of the old story, so each one's filter is tested
    for (const table of ['story_embeddings', 'story_research_runs', 'story_context_runs', 'context_facts', 'context_boxes', 'research_passes'] as const)
      expect(
        before[table].some(r => r.storyId === old.id),
        table,
      ).toBe(true)
    for (const table of ['article_versions', 'evidence_searches', 'evidence_sources', 'pool_facts', 'pass_boxes'] as const)
      expect(
        before[table].some(r => r.storyId === old.id),
        table,
      ).toBe(true)

    const file = join(dir, 'window.jsonl.gz')
    const now = new Date()
    const summary = await exportWindow(file, now)
    expect(summary.window).toEqual(copyWindow(6, now))
    expect(summary.inWindow).toBe(3)
    expect(summary.nulled).toEqual({ 'story_context_runs.research_run_id': 1 })
    const header = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8').split('\n')[0]!) as { window: unknown }
    expect(header.window).toEqual(copyWindow(6, now))

    // The import loads every row with the foreign keys enforced: a reference outside the copy would fail it
    const imported = await importEvalCopy(prisma, file)
    expect(imported.window).toEqual(copyWindow(6, now))
    expect(await snapshot()).toEqual(expected)
  })

  it('refuses, writing no file, a windowed copy with a row whose required reference points outside it', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const recent = await createStory({ feedId: feed.id })
    // A context fact of a recent story on a run whose story is gone
    const orphanRun = await createContextRun(recent.id)
    await createContextFact(recent.id, orphanRun.id, { ref: 'C1F1' })
    await prisma.storyContextRun.update({ where: { id: orphanRun.id }, data: { storyId: null } })

    const file = join(dir, 'refused.jsonl.gz')
    await expect(exportWindow(file, new Date())).rejects.toThrow(/context_facts\.run_id/)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(`${file}.partial`)).toBe(false)
  })

  it("reads the copy's foreign keys from the database as the schema declares them", async () => {
    const tables = EXPORTED_TABLES.map(t => t.table)
    const fromSchema = readPrismaSchema()
      .filter(t => tables.includes(t.table))
      .flatMap(t => t.foreignKeys.map(fk => ({ table: t.table, column: fk.columns[0], target: fk.table })))
    const fromDatabase = (await foreignKeys(prisma, tables)).map(fk => ({ table: fk.table, column: fk.column, target: fk.target }))
    const order = (a: { table: string; column?: string }, b: { table: string; column?: string }) =>
      a.table.localeCompare(b.table) || (a.column ?? '').localeCompare(b.column ?? '')
    expect(fromDatabase.sort(order)).toEqual(fromSchema.sort(order))
  })
})
