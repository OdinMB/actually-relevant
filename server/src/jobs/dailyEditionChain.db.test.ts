/**
 * The daily edition on PostgreSQL, through the real scheduler (`runJob`), chain runner and publish job:
 * context can never hold the edition. Selection and research are switched off, so the chain runs the
 * context step and publishing on the stories the test gives it; the context step fails before it
 * claims any story, or is held elsewhere past the chain's wait, and the night's story still goes out.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'

// The context step fails before it claims any story: its first database read after the stale runs
const mocks = vi.hoisted(() => ({ pruneSearchCache: vi.fn() }))
vi.mock('../services/storyContextSearch.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/storyContextSearch.js')>()),
  pruneSearchCache: mocks.pruneSearchCache,
}))
// Publishing refreshes embeddings; nothing calls OpenAI here
vi.mock('../services/embedding.js', () => ({
  generateEmbeddingForContent: vi.fn(),
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))

const { default: prisma } = await import('../lib/prisma.js')
const { config } = await import('../config.js')
const { createFeed, createIssue, createStory, describeDb, useTestDatabase } = await import('../test/db/harness.js')
const { createResearchRun } = await import('../test/db/storyContext.js')
const { runJob } = await import('./scheduler.js')
const { JOB_HANDLERS } = await import('./handlers.js')

const CHAIN = 'daily_edition_chain'
const STEPS = { select_stories: false, research_stories: false, build_story_context: true, publish_stories: true }

async function seedJobs() {
  await prisma.jobRun.create({ data: { jobName: CHAIN, cronExpression: '0 23 * * *', enabled: true } })
  for (const [jobName, enabled] of Object.entries(STEPS)) await prisma.jobRun.create({ data: { jobName, cronExpression: '0 0 * * *', enabled } })
}

/** A selected story with research facts and no context run: the step owes it its cards tonight. */
async function owedStory() {
  const feed = await createFeed((await createIssue()).id)
  const story = await createStory({ feedId: feed.id, status: 'selected', title: 'Fires in Kalimantan', summary: 'Fires burned.' })
  await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
  return story
}

const runEdition = () => runJob(CHAIN, JOB_HANDLERS[CHAIN]!)
const statusOf = async (id: string) => (await prisma.story.findUniqueOrThrow({ where: { id }, select: { status: true } })).status
const publishSaid = async () => (await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'publish_stories' } })).lastRunSummary

describeDb('the daily edition: context never holds it (PostgreSQL)', () => {
  useTestDatabase()

  const savedChains = { ...config.chains }
  beforeEach(async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    mocks.pruneSearchCache.mockReset().mockRejectedValue(new Error('database gone'))
    await seedJobs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    Object.assign(config.chains, savedChains)
  })

  it('publishes the night’s story when the context step fails before it takes any story', async () => {
    const story = await owedStory()

    expect(await runEdition()).toEqual({ result: 'succeeded' })

    expect(await publishSaid()).toBe('Published 1 story')
    expect(await statusOf(story.id)).toBe('published')
    expect(await prisma.storyContextRun.count()).toBe(0)
    const step = await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'build_story_context' } })
    expect(step.lastError).toMatch(/database gone/)
    expect(await prisma.jobRun.findUniqueOrThrow({ where: { jobName: CHAIN } })).toMatchObject({ lastError: null, resumeStep: null })
  })

  it('publishes the night’s story when the context step is held elsewhere past the chain’s wait for it', async () => {
    Object.assign(config.chains, { stepWaitMinutes: 0, stepWaitPollMs: 1 })
    const story = await owedStory()
    // A run by hand in another process holds the step's lease
    await prisma.$executeRaw`
      UPDATE job_runs SET locked_by = 'other-host:1:abcd1234', locked_until = (now() AT TIME ZONE 'UTC') + interval '1 hour'
      WHERE job_name = 'build_story_context'`

    expect(await runEdition()).toEqual({ result: 'succeeded' })

    expect(await publishSaid()).toBe('Published 1 story')
    expect(await statusOf(story.id)).toBe('published')
    expect(mocks.pruneSearchCache).not.toHaveBeenCalled()
  })
})
