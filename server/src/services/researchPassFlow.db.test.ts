/**
 * A later research pass from claim to reader on PostgreSQL: a story researched before passes, its
 * legacy runs imported into the pool by the claim, the real input loader and pipeline over fake model
 * calls and searches, the pass's self-applying store (`storePassResult` and the story's fenced write),
 * the Update readers are served, and an editor's undo with the facts the pass demoted back in use.
 * `researchPass.test.ts` tests the pipeline's rules; `researchPassRuns.db.test.ts` the lifecycle over
 * a fake pipeline. The embedding call and the favicon fetch are mocked; the eval gate is open.
 */
import type { Prisma } from '@prisma/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { promptText } from '../lib/promptCache.js'
import prisma from '../lib/prisma.js'
import { axisVector, createCluster, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createResearchRun } from '../test/db/storyContext.js'
import type { PassDeps } from './researchPass.js'
import type { PassStep } from './researchPassSteps.js'
import type { ResearchedSource, ResearchedStory } from './researchedStory.js'

vi.mock('./researchPassGate.js', () => ({ PASS_EVAL_GATE: null }))
const mockGenerate = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
vi.mock('./sourceFavicons.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sourceFavicons.js')>()),
  fetchSourceFaviconsInBackground: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./relatedStories.js', async importOriginal => ({ ...(await importOriginal<typeof import('./relatedStories.js')>()), forgetRelatedStories: vi.fn() }))

const { claimPass, executePass } = await import('./researchPassRuns.js')
const { undoUpdate } = await import('./researchWrites.js')
const { getPublishedStoryBySlug } = await import('./publicStories.js')
const { loadPool, storyVersions } = await import('./passRecords.js')
const { _setProcessStartedAt } = await import('../lib/runCutOff.js')

const DAY_MS = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS)
const words = (seed: string, n = 150) => Array.from({ length: n }, (_, i) => `${seed}w${i}`).join(' ')

const source = (id: string, origin: ResearchedSource['origin'], url: string): ResearchedSource => ({
  id,
  origin,
  outlet: `Outlet ${id}`,
  host: new URL(url).host,
  url,
  title: `Title ${id}`,
  date: '2026-11-12',
  country: 'Pakistan',
  kind: 'news-report',
  storyId: null,
  slug: null,
})

/** The text research applied before passes existed: two paragraphs, the second citing the import figure a newer report corrects. */
const legacyResearch = (originalUrl: string, s1Url: string): ResearchedStory => ({
  paragraphs: [
    { sentences: [{ text: 'Pakistan added 22 GW of rooftop solar in two years.', citations: [{ sourceId: 'S0', sentence: 'Sentence S0F1.' }] }] },
    { sentences: [{ text: 'Imports of panels doubled.', citations: [{ sourceId: 'S1', sentence: 'Sentence S1F1.' }] }] },
  ],
  whyThisMatters: [{ text: 'Cheap power reaches millions.', citations: [] }],
  caveats: [{ text: 'The grid lags behind.', citations: [] }],
  quoteSourceId: null,
  sources: [source('S0', 'original', originalUrl), source('S1', 'source', s1Url)],
})

const SINGLE_SOURCE = {
  title: 'Single-source headline',
  titleLabel: 'Solar',
  summary: 'Single-source summary.',
  quote: null,
  quoteAttribution: null,
  marketingBlurb: null,
  relevanceReasons: '- Single-source reason.',
  relevanceSummary: null,
  antifactors: '- Single-source caveat.',
  emotionTag: 'calm',
}

const CORRECTION = 'Panel imports rose by a third, not doubled.'
const REWRITE = 'Panel imports rose by about a third, a later report found.'
const NOTE = 'A later report put the rise in panel imports at a third rather than a doubling.'

const fields = {
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact',
  provisional: false,
  counted: '',
  place: '',
  asOf: '',
  credited: '',
  creditedKind: 'none',
  validity: 'fixed',
}

const items = (prompt: string) => [...prompt.matchAll(/<ITEM number="(\d+)" label="([^"]+)">/g)].map(m => Number(m[1]))
const supported = (prompt: string) => ({
  items: items(prompt).map(number => ({ number, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })),
})

/**
 * The model calls and searches of one later pass: the cluster member's page gives the correcting
 * fact, every check passes, the judge flags the paragraph citing the corrected figure and names the
 * fact it contradicts, the rewrite and the note cite the new fact, and the cards come to none.
 */
function fakeDeps() {
  const steps: PassStep[] = []
  // The correcting fact's ref, as the judge reads it among the new facts
  let fresh = ''
  const answers: Partial<Record<PassStep, (prompt: string) => unknown>> = {
    queries: () => ({ queries: [{ query: 'Pakistan rooftop solar imports', language: 'en' }] }),
    extract: () => ({
      usable: true,
      relation: 'same-development',
      kind: 'news-report',
      outlet: '',
      country: 'Pakistan',
      facts: [{ statement: CORRECTION, supportingSentence: 'Panel imports rose by a third, customs data show.', measures: '' }],
      voices: [],
    }),
    structure: prompt => ({ facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({ id: m[1], ...fields })) }),
    'gap-list': () => ({
      slots: [{ slot: 'response', needed: true, covered: 'yes' }],
      responseInStory: '',
      responseSearches: { action: '', elsewhere: '' },
      searches: [],
    }),
    'facts-check': supported,
    judge: prompt => {
      const newFacts = prompt.slice(prompt.indexOf('<NEW_FACTS>'))
      fresh = new RegExp(`<FACT id="([^"]+)"[^>]*>${CORRECTION}`).exec(newFacts)?.[1] ?? ''
      return {
        sections: [{ label: 'Story paragraph 2', verdict: 'wrong', factIds: [fresh], reason: 'Imports rose by a third.' }],
        contradicted: [{ factId: 'S1F1', byFactIds: [fresh], reason: 'Imports did not double.' }],
      }
    },
    update: () => ({ items: [{ label: 'Story paragraph 2', text: REWRITE, factIds: [fresh] }], quote: '', quoteAttribution: '', quoteSourceId: '' }),
    'fact-check': supported,
    note: () => ({ text: NOTE, factIds: [fresh] }),
    'cards-write': () => ({ boxes: [] }),
  }
  const deps: PassDeps = {
    async call(step, _schema, prompt) {
      steps.push(step)
      const answer = answers[step]?.(promptText(prompt)) ?? null
      return { parsed: answer as never, outcome: answer === null ? 'error' : 'ok', usage: ZERO_USAGE, costUsd: 0.001, model: `model-${step}` }
    },
    tavily: { search: async () => ({ results: [], credits: 2 }) },
    search: async () => ({ results: [], credits: 1, cached: false }),
    relevanceMin: 5,
  }
  return { deps, steps, fresh: () => fresh }
}

/** A published story researched before passes: its legacy run, its applied text, and a cluster member published since with a new page. */
async function legacyStory() {
  const feedId = (await createFeed((await createIssue()).id)).id
  const story = await createStory({ feedId, status: 'published', slug: 'pakistan-solar', relevance: 6, datePublished: daysAgo(3), emotionTag: 'calm' })
  const originalUrl = story.sourceUrl
  const s1Url = `https://s1.example/${story.id}`
  const research = legacyResearch(originalUrl, s1Url)
  await prisma.story.update({
    where: { id: story.id },
    data: {
      title: 'Researched headline',
      titleLabel: 'Solar',
      summary: 'Researched summary.',
      relevanceReasons: '- Cheap power reaches millions.',
      antifactors: '- The grid lags behind.',
      sourceContent: `Pakistan has added 22GW of rooftop solar. ${words('original')}`,
      research: research as unknown as Prisma.InputJsonObject,
      preResearch: SINGLE_SOURCE as unknown as Prisma.InputJsonObject,
    },
  })
  await createResearchRun(
    story.id,
    [
      {
        id: 'S0',
        url: originalUrl,
        facts: [{ id: 'S0F1', statement: 'Pakistan added 22 GW of rooftop solar in two years.', supportingSentence: 'Sentence S0F1.' }],
      },
      { id: 'S1', url: s1Url, facts: [{ id: 'S1F1', statement: 'Imports of panels doubled.', supportingSentence: 'Sentence S1F1.' }] },
    ],
    { startedAt: daysAgo(2) },
  )
  const member = await createStory({ feedId, status: 'analyzed', title: 'Member', summary: 'Member summary.', relevance: 5 })
  await prisma.story.update({
    where: { id: member.id },
    data: {
      sourceUrl: 'https://wire.example/pakistan-solar-imports',
      sourceContent: `Panel imports rose by a third, customs data show. ${words('wire')}`,
    },
  })
  await createCluster([story.id, member.id], story.id)
  return { id: story.id, research }
}

/** An editor's pass of the story as the button runs it: the story read, the claim, the pass over fake deps, its apply. */
async function editorPass(storyId: string, fake: ReturnType<typeof fakeDeps>) {
  const row = await prisma.story.findUniqueOrThrow({ where: { id: storyId }, select: { status: true, updatedAt: true } })
  const claim = await claimPass(storyId, 'editor')
  if ('refused' in claim) throw new Error(`claim refused: ${claim.refused}`)
  const end = await executePass(storyId, claim, { actor: 'editor', read: row, deps: () => fake.deps })
  return { claim, end }
}

const statuses = async (storyId: string) =>
  (await storyVersions(prisma, storyId)).map(v => [v.number, v.kind, v.status]).sort((a, b) => Number(a[0]) - Number(b[0]))

describeDb('a later pass from claim to reader', () => {
  useTestDatabase()

  beforeEach(() => {
    _setProcessStartedAt(daysAgo(1))
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(5), hash: 'researched' })
  })

  afterEach(() => _setProcessStartedAt(null))

  it('imports a legacy story, rewrites the paragraph a newer fact corrects as version 2, serves its Update, and an undo restores version 1 and the fact it demoted', async () => {
    const story = await legacyStory()
    const fake = fakeDeps()
    const { claim, end } = await editorPass(story.id, fake)

    // The claim imported the legacy run, so the story got a later pass against version 1
    expect(claim).toMatchObject({ kind: 'later' })
    expect(end, `steps ${fake.steps.join(', ')}`).toMatchObject({ ended: 'completed', outcome: 'updated', applied: 'applied', why: null })
    expect(fake.steps).not.toContain('write')
    const fresh = fake.fresh()
    expect(fresh).toMatch(/^S\d+F1$/)

    // Version 1 the legacy text, superseded; version 2 the update, current, its pass's
    expect(await statuses(story.id)).toEqual([
      [1, 'legacy', 'superseded'],
      [2, 'update', 'current'],
    ])
    const pass = await prisma.researchPass.findUniqueOrThrow({ where: { id: claim.passId } })
    const v2 = (await storyVersions(prisma, story.id)).find(v => v.number === 2)!
    expect(pass).toMatchObject({ kind: 'later', status: 'completed', outcome: 'updated', versionId: v2.id, trigger: 'editor' })
    expect(v2).toMatchObject({ passId: claim.passId, note: { text: NOTE } })
    expect(v2.changes.map(c => c.section)).toEqual(['Story paragraph 2'])

    // The story's columns carry version 2: the rewritten paragraph, the first byte for byte, the single-source snapshot kept
    const row = await prisma.story.findUniqueOrThrow({ where: { id: story.id }, select: { research: true, preResearch: true, title: true, summary: true } })
    const research = row.research as unknown as ResearchedStory
    expect(research.paragraphs[0]).toEqual(story.research.paragraphs[0])
    expect(research.paragraphs[1]?.sentences.map(s => s.text).join(' ')).toBe(REWRITE)
    expect(row).toMatchObject({ title: 'Researched headline', summary: 'Researched summary.', preResearch: SINGLE_SOURCE })

    // The pool: the corrected fact demoted by this pass, the new page's fact found and checked by it
    const pool = await loadPool(prisma, story.id)
    expect(pool.facts.find(f => f.ref === 'S1F1')).toMatchObject({
      status: 'demoted',
      drop: { passId: claim.passId, reason: 'contradicted', contradictedBy: [fresh] },
    })
    expect(pool.facts.find(f => f.ref === fresh)).toMatchObject({ statement: CORRECTION, verdict: 'supported', firstPassId: claim.passId })
    expect(pool.sources.find(s => s.ref === fresh.replace(/F\d+$/, ''))).toMatchObject({ url: 'https://wire.example/pakistan-solar-imports' })

    // Readers get version 2 and its Update, with the paragraph as it read before
    const served = await getPublishedStoryBySlug('pakistan-solar')
    expect(served?.research?.paragraphs[1]?.sentences.map(s => s.text).join(' ')).toBe(REWRITE)
    expect(served?.updates).toHaveLength(1)
    expect(served?.updates[0]).toMatchObject({
      note: { text: NOTE },
      changes: [{ section: 'Story paragraph 2', before: { text: 'Imports of panels doubled.' }, removed: false }],
    })
    expect(served?.updates[0]?.sources.map(s => s.url)).toEqual(expect.arrayContaining([`https://s1.example/${story.id}`]))

    // An editor's undo: version 1 back on the story and current, version 2 reverted, no Update, the demoted fact in use again
    await undoUpdate(story.id)
    expect(await statuses(story.id)).toEqual([
      [1, 'legacy', 'current'],
      [2, 'update', 'reverted'],
    ])
    const undone = await prisma.story.findUniqueOrThrow({ where: { id: story.id }, select: { research: true, preResearch: true } })
    expect(undone).toEqual({ research: story.research, preResearch: SINGLE_SOURCE })
    expect((await getPublishedStoryBySlug('pakistan-solar'))?.updates).toEqual([])
    expect((await loadPool(prisma, story.id)).facts.find(f => f.ref === 'S1F1')).toMatchObject({ status: 'unreviewed', drop: null })
  })
})
