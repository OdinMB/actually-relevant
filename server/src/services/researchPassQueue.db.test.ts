/**
 * The research pass step's state, its queue and the publish gate, on PostgreSQL
 * (`researchPassQueue.ts`). A story's passes are inserted as rows; nothing researches here. The eval
 * gate is open in these tests unless one closes it: with it closed, nothing is owed a wait.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'

const gate = vi.hoisted(() => ({ closed: null as string | null }))
vi.mock('./researchPassGate.js', () => ({
  get PASS_EVAL_GATE() {
    return gate.closed
  },
}))

const { awaitingPass, nextForPass, owedPassStory, passStepState } = await import('./researchPassQueue.js')
const { _setProcessStartedAt } = await import('./storyContextStale.js')
const { PASS_EVAL_GATE: realGate } = await vi.importActual<typeof import('./researchPassGate.js')>('./researchPassGate.js')

const MINUTE_MS = 60_000
const NOW = new Date()
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS)
const WAIT = config.research.pipeline.maxWaitMinutes
const STALE = config.storyContext.staleRunMinutes

let feedId = ''

const selected = (dateCrawled = new Date(), selectedAt: Date | null = NOW) => createStory({ feedId, status: 'selected', dateCrawled, selectedAt })

async function passOf(
  storyId: string,
  data: { trigger?: 'editor' | 'pipeline'; status: 'running' | 'completed' | 'skipped' | 'failed'; startedAt?: Date; number?: number },
) {
  await prisma.researchPass.create({
    data: {
      storyId,
      number: data.number ?? 1,
      trigger: data.trigger ?? 'pipeline',
      kind: 'first',
      status: data.status,
      costUsd: 0.4,
      startedAt: data.startedAt ?? NOW,
    },
  })
}

const setJob = (enabled: boolean) =>
  prisma.jobRun.upsert({
    where: { jobName: 'research_pass' },
    update: { enabled },
    create: { jobName: 'research_pass', cronExpression: '30 1 * * *', enabled },
  })

describeDb('research pass step state, queue and publish gate (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    gate.closed = null
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    // This process started long ago, so only the stale limit cuts a pass off, unless a test says otherwise
    _setProcessStartedAt(ago(24 * 60))
    await setJob(true)
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    _setProcessStartedAt(null)
  })

  it('lets through a story whose pass is running from before this process started: a restart cut it off', async () => {
    _setProcessStartedAt(ago(10))
    const cutOff = await selected()
    await passOf(cutOff.id, { status: 'running', startedAt: ago(30) })
    const live = await selected()
    await passOf(live.id, { status: 'running', startedAt: ago(5) })

    expect(await awaitingPass([cutOff.id, live.id], NOW)).toEqual(new Set([live.id]))
  })

  it('works only while the eval gate is open and the key set, and reads the job row’s flag apart', async () => {
    expect(await passStepState()).toEqual({ works: true, enabled: true })
    await setJob(false)
    expect(await passStepState()).toEqual({ works: true, enabled: false })
    await prisma.jobRun.deleteMany({ where: { jobName: 'research_pass' } })
    expect(await passStepState()).toEqual({ works: true, enabled: false })

    await setJob(true)
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await passStepState()).toEqual({ works: false, enabled: true })

    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    gate.closed = realGate
    expect(await passStepState()).toEqual({ works: false, enabled: true })
  })

  it('keeps waiting a selected story with no pipeline pass, one whose pass runs within the stale rule, and one only an editor researched', async () => {
    const none = await selected()
    const running = await selected()
    await passOf(running.id, { status: 'running', startedAt: ago(STALE - 5) })
    const byEditor = await selected()
    await passOf(byEditor.id, { trigger: 'editor', status: 'completed' })

    expect(await awaitingPass([none.id, running.id, byEditor.id], NOW)).toEqual(new Set([none.id, running.id, byEditor.id]))
  })

  it('lets through a story whose pipeline pass completed, was skipped, failed or was cut off by a restart, one with research applied, and another status', async () => {
    const ids: string[] = []
    for (const status of ['completed', 'skipped', 'failed'] as const) {
      const s = await selected()
      await passOf(s.id, { status })
      ids.push(s.id)
    }
    const cutOff = await selected()
    await passOf(cutOff.id, { status: 'running', startedAt: ago(STALE + 5) })
    const applied = await selected()
    await prisma.story.update({ where: { id: applied.id }, data: { preResearch: { title: 'single' } as Prisma.InputJsonObject } })
    const analyzed = await createStory({ feedId, status: 'analyzed' })

    expect(await awaitingPass([...ids, cutOff.id, applied.id, analyzed.id], NOW)).toEqual(new Set())
  })

  it(`holds a story at most ${WAIT} minutes after it was selected`, async () => {
    const fresh = await selected(new Date(), ago(WAIT - 1))
    const old = await selected(new Date(), ago(WAIT + 1))
    const never = await selected(new Date(), null)

    expect(await awaitingPass([fresh.id, old.id, never.id], NOW)).toEqual(new Set([fresh.id]))
  })

  it('holds nothing while the gate is closed, the key unset or the job disabled', async () => {
    const story = await selected()
    for (const off of [() => (gate.closed = realGate), () => vi.stubEnv('TAVILY_API_KEY', ''), () => setJob(false)]) {
      gate.closed = null
      vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
      await setJob(true)
      await off()
      expect(await awaitingPass([story.id], NOW)).toEqual(new Set())
    }
    expect(await awaitingPass([], NOW)).toEqual(new Set())
  })

  it('queues the selected stories it owes, oldest crawled first, up to the limit, leaving out any with a pipeline pass, even a live one', async () => {
    const newer = await selected(ago(10))
    const older = await selected(ago(60))
    const oldest = await selected(ago(120))
    const passed = await selected(ago(200))
    await passOf(passed.id, { status: 'running' })
    const byEditor = await selected(ago(30))
    await passOf(byEditor.id, { trigger: 'editor', status: 'completed' })

    expect(await nextForPass(10)).toEqual([oldest.id, older.id, byEditor.id, newer.id])
    expect(await nextForPass(2)).toEqual([oldest.id, older.id])
  })

  it('reads a story’s last write while it is still owed, and nothing once it has a pipeline pass or moved on', async () => {
    const story = await selected()
    expect(await owedPassStory(story.id)).toEqual({ updatedAt: story.updatedAt })

    await passOf(story.id, { status: 'failed' })
    expect(await owedPassStory(story.id)).toBeNull()

    const published = await createStory({ feedId, status: 'published' })
    expect(await owedPassStory(published.id)).toBeNull()
  })
})
