/**
 * The eval copy against PostgreSQL: an export through the read-only session holds every exported
 * table's rows, its person-naming values scrubbed, and nothing of the tables left out; an import into
 * the same (test) database empties it and gives back the same rows, vectors bit for bit; and an import
 * of a copy it must refuse leaves the database as it was.
 */
import { afterAll, beforeAll, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import prisma from '../../lib/prisma.js'
import { createCluster, createFeed, createIssue, createNewsletter, createStory, describeDb, useTestDatabase } from '../../test/db/harness.js'
import { createPass, createPassBox, createPoolFact, createPoolSource } from '../../test/db/passes.js'
import { createContextBox, createContextFact, createContextRun, createResearchRun } from '../../test/db/storyContext.js'
import { openReadOnlyDb } from '../eval/readOnlyDb.js'
import { headerLine, rowLine, trailerLine } from './copyFile.js'
import { exportEvalCopy } from './exportCopy.js'
import { importEvalCopy } from './importCopy.js'
import { EXPORTED_TABLES } from './tables.js'

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
  await prisma.$executeRaw`INSERT INTO story_embeddings (story_id, embedding, content_hash) VALUES (${a.id}, ${vectorLiteral(7.3)}::vector, 'hash-a'), (${b.id}, ${vectorLiteral(2.9)}::vector, 'hash-b')`

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

describeDb('the eval copy (PostgreSQL)', () => {
  useTestDatabase()

  it('exports every exported table scrubbed and none left out, and an import gives the same rows back, vectors bit for bit', async () => {
    const { detachId } = await fillDatabase()
    const before = await snapshot()
    const fingerprints = await vectorFingerprints()
    // Every exported table holds a row, so each one's round trip is tested
    expect(Object.keys(before).sort()).toEqual(EXPORTED_TABLES.map(t => t.table).sort())
    for (const [table, rows] of Object.entries(before)) expect(rows.length, table).toBeGreaterThan(0)

    const file = join(dir, 'copy.jsonl.gz')
    const session = await openReadOnlyDb()
    const summary = await exportEvalCopy(session, file).finally(() => session.close())

    // No person's details anywhere in the file, and no table but the exported ones
    const text = gunzipSync(readFileSync(file)).toString('utf8')
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    const lines = text.trimEnd().split('\n')
    expect([...new Set(lines.slice(1, -1).map(l => (JSON.parse(l) as { table: string }).table))]).toEqual(EXPORTED_TABLES.map(t => t.table))
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
    const header = headerLine({ exportedAt: new Date().toISOString(), migration: null })
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
})
