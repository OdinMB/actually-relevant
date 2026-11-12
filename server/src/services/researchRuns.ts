/**
 * The story research run lifecycle, the admin action (`.context/story-research.md`): the switch,
 * price and eligibility checks, the reservation against the monthly cap under an advisory lock,
 * the background run as a one-story `research` task, the finish write, interrupted runs, the
 * story's run list and the month's spend. A run writes only its own `story_research_runs` row: it
 * never moves a status, writes a story field or applies its verdict. Refusals are ServiceErrors.
 */
import type { Prisma, StoryResearchRun } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { utcMonthStart } from './podcastGuards.js'
import { researchSourcePolicy } from './publisherOptOut.js'
import { createRunMeter } from './researchCalls.js'
import { hasPrice, summarizeRunCost, type RunCostSummary } from './researchCost.js'
import { RESEARCHABLE_STATUSES, researchStoriesByIds, type ResearchStory } from './researchInput.js'
import { researchStory, STEP_TIERS, STEPS, type StepName, type StoryResearch } from './researchPipeline.js'

const log = createLogger('research')

/** Arbitrary constant key of the transaction-level advisory lock that serialises reservations (not the TTS one). */
const RESEARCH_RESERVATION_LOCK = 7_303_201

const INTERRUPTED = 'interrupted: the server restarted during the run'

/** The prices a run was counted at, stored with it. */
export interface ResearchPrices {
  models: Record<string, { input: number; cached: number; output: number }>
  cacheWriteFactor: number
  tavilyUsdPerCredit: number
}

/** A run's `result`: what the pipeline found, with the model id of each step and the prices it ran at. */
export interface StoredResearch extends StoryResearch {
  models: Record<StepName, string>
  prices: ResearchPrices
}

export interface ResearchRunView {
  id: string
  storyId: string | null
  status: StoryResearchRun['status']
  verdict: string | null
  /** The reservation while running; the measured cost once completed; a failed run keeps its reservation. */
  costUsd: number
  tavilyCredits: number
  error: string | null
  startedAt: string
  finishedAt: string | null
  result: StoredResearch | null
  cost: RunCostSummary | null
}

export interface ResearchUsageView {
  /** Key present and every step's model priced. */
  enabled: boolean
  /** Why a run would be refused now (switched off, unpriced model, cap reached), or null. */
  refusal: string | null
  monthToDateUsd: number
  monthlyCapUsd: number
  /** What each run reserves when it starts. */
  reservationUsd: number
}

type Db = Prisma.TransactionClient | typeof prisma

function stepModels(): Record<StepName, string> {
  return Object.fromEntries(STEPS.map(step => [step, config.llm.models[STEP_TIERS[step]].name])) as Record<StepName, string>
}

function currentPrices(models: string[]): ResearchPrices {
  return {
    models: Object.fromEntries(models.flatMap(m => (config.research.modelPrices[m] ? [[m, config.research.modelPrices[m]]] : []))),
    cacheWriteFactor: config.research.cacheWriteFactor,
    tavilyUsdPerCredit: config.research.tavilyUsdPerCredit,
  }
}

/** Why no run can start now, whatever the story: switched off, or a step's model without a price. */
function switchRefusal(): string | null {
  if (!config.research.tavilyApiKey) return 'Research is switched off: TAVILY_API_KEY is not set'
  const unpriced = [...new Set(Object.values(stepModels()))].filter(m => !hasPrice(m))
  if (unpriced.length > 0) return `Research is refused: ${unpriced.join(', ')} has no price in config.research.modelPrices, so its cost could not be counted`
  return null
}

const usd = (v: number) => `$${v.toFixed(2)}`

const capRefusal = (spentUsd: number) =>
  `This month's research cap is reached: ${usd(spentUsd)} of ${usd(config.research.monthlyCapUsd)} spent, and a run reserves ${usd(config.research.maxRunUsd)}`

const isResearchable = (status: string) => (RESEARCHABLE_STATUSES as readonly string[]).includes(status)

/** USD of every run started this UTC month, deleted stories' runs and running reservations included. */
async function monthSpendUsd(db: Db, now: Date, exceptRunId?: string): Promise<number> {
  const { _sum } = await db.storyResearchRun.aggregate({
    _sum: { costUsd: true },
    where: { startedAt: { gte: utcMonthStart(now) }, ...(exceptRunId ? { id: { not: exceptRunId } } : {}) },
  })
  return _sum.costUsd ?? 0
}

/** A run still `running` past the stale limit was cut off by a restart: failed, keeping its reservation as its cost. */
async function markInterruptedRuns(db: Db, now: Date): Promise<void> {
  await db.storyResearchRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - config.research.staleRunMinutes * 60_000) } },
    data: { status: 'failed', error: INTERRUPTED, finishedAt: now },
  })
}

/**
 * Insert the run with the ceiling as its cost. The advisory lock, taken first, serialises
 * reservations, so concurrent starts cannot overrun the cap or run one story twice.
 */
async function reserveRun(storyId: string, now: Date): Promise<string> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESEARCH_RESERVATION_LOCK}::bigint)`
    await markInterruptedRuns(tx, now)
    if ((await tx.storyResearchRun.count({ where: { storyId, status: 'running' } })) > 0) {
      throw new ConflictError('A research run of this story is already in progress')
    }
    const spent = await monthSpendUsd(tx, now)
    if (spent + config.research.maxRunUsd > config.research.monthlyCapUsd) throw new ConflictError(capRefusal(spent))
    const run = await tx.storyResearchRun.create({
      data: { storyId, status: 'running', costUsd: config.research.maxRunUsd, startedAt: now },
      select: { id: true },
    })
    return run.id
  })
}

/** An unexpected error by name and code only: a message may quote fetched text or a query's arguments. */
function sanitizedError(err: unknown): string {
  if (!(err instanceof Error)) return 'unexpected error'
  const code = (err as { code?: unknown }).code
  return `unexpected error (${err.name}${typeof code === 'string' ? ` ${code}` : ''})`
}

/** The finish write, conditional on the row still running: a run marked interrupted meanwhile stays failed. */
async function finishRun(runId: string, result: StoryResearch): Promise<{ written: boolean; costUsd: number }> {
  const models = stepModels()
  const stored: StoredResearch = { ...result, models, prices: currentPrices(Object.values(models)) }
  const costUsd = summarizeRunCost(result, config.research.tavilyUsdPerCredit).totalUsd
  const { count } = await prisma.storyResearchRun.updateMany({
    where: { id: runId, status: 'running' },
    data: {
      status: 'completed',
      verdict: result.verdict.kind,
      costUsd,
      tavilyCredits: result.credits,
      result: stored as unknown as Prisma.InputJsonObject,
      finishedAt: new Date(),
    },
  })
  return { written: count > 0, costUsd }
}

/** Runs the research and records it. Any verdict, `fallback` included, completes the task; only an unexpected error fails it. */
async function runInBackground(runId: string, taskId: string, story: ResearchStory): Promise<void> {
  try {
    const meter = createRunMeter({
      ceilingUsd: config.research.maxRunUsd,
      monthRoomUsd: async () => config.research.monthlyCapUsd - (await monthSpendUsd(prisma, new Date(), runId)),
    })
    // The run time caps the search window, so a fresh story never asks Tavily for a future date
    const result = await researchStory(story, {
      call: meter.call,
      tavily: meter.tavily,
      admit: meter.admit,
      relevanceMin: config.selection.relevanceMin,
      latestDate: new Date().toISOString(),
      sourcePolicy: researchSourcePolicy,
    })
    const { written, costUsd } = await finishRun(runId, result)
    if (!written) {
      log.warn({ runId, storyId: story.id }, 'research run finished after it was marked interrupted; its result was dropped')
      taskRegistry.increment(taskId, 'failed', 'The run was marked interrupted before it finished')
      return
    }
    log.info({ runId, storyId: story.id, verdict: result.verdict.kind, costUsd }, 'research run finished')
    taskRegistry.increment(taskId, 'completed')
  } catch (err) {
    const error = sanitizedError(err)
    log.error({ runId, storyId: story.id, error }, 'research run failed')
    await prisma.storyResearchRun
      .updateMany({ where: { id: runId, status: 'running' }, data: { status: 'failed', error, finishedAt: new Date() } })
      .catch((e: unknown) => log.error({ runId, error: sanitizedError(e) }, 'could not mark the research run failed'))
    taskRegistry.increment(taskId, 'failed', error)
  } finally {
    taskRegistry.complete(taskId)
  }
}

/**
 * Start a research run of one story in the background: 404 for an unknown story; 409 when research
 * is switched off or a model is unpriced, for a status other than analyzed, selected or published,
 * for a story without the analysis research needs (checked before any reservation is written), at
 * the cap, or while a run of the story is in progress.
 */
export async function startResearchRun(storyId: string, now: Date = new Date()): Promise<{ taskId: string; runId: string }> {
  const off = switchRefusal()
  if (off) throw new ConflictError(off)
  const row = await prisma.story.findUnique({ where: { id: storyId }, select: { status: true } })
  if (!row) throw new NotFoundError('Story not found')
  if (!isResearchable(row.status)) throw new ConflictError(`Only analyzed, selected or published stories can be researched; this one is ${row.status}`)
  const [story] = await researchStoriesByIds(prisma, [storyId])
  if (!story) throw new ConflictError('This story lacks the analysis research needs')

  const runId = await reserveRun(storyId, now)
  const taskId = taskRegistry.create('research', 1, [storyId])
  log.info({ runId, storyId, taskId }, 'research run started')
  void runInBackground(runId, taskId, story)
  return { taskId, runId }
}

function toView(run: StoryResearchRun): ResearchRunView {
  const result = run.result as unknown as StoredResearch | null
  return {
    id: run.id,
    storyId: run.storyId,
    status: run.status,
    verdict: run.verdict,
    costUsd: run.costUsd,
    tavilyCredits: run.tavilyCredits,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    result,
    cost: result ? summarizeRunCost(result, result.prices.tavilyUsdPerCredit) : null,
  }
}

/** The story's latest runs, newest first, after marking interrupted ones. */
export async function listResearchRuns(storyId: string, now: Date = new Date()): Promise<ResearchRunView[]> {
  await markInterruptedRuns(prisma, now)
  const runs = await prisma.storyResearchRun.findMany({
    where: { storyId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: config.research.runsListed,
  })
  return runs.map(toView)
}

export async function researchUsage(now: Date = new Date()): Promise<ResearchUsageView> {
  const monthToDateUsd = await monthSpendUsd(prisma, now)
  const off = switchRefusal()
  const atCap = monthToDateUsd + config.research.maxRunUsd > config.research.monthlyCapUsd
  return {
    enabled: off === null,
    refusal: off ?? (atCap ? capRefusal(monthToDateUsd) : null),
    monthToDateUsd,
    monthlyCapUsd: config.research.monthlyCapUsd,
    reservationUsd: config.research.maxRunUsd,
  }
}
