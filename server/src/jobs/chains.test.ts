import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = {
  enabled: boolean
  pauseForReview: boolean
  notBefore: string | null
  interruptedRuns: number
  resumeStep: string | null
  resumeReason: string | null
  resumeAt: Date | null
  chainStartedAt: Date | null
}

const rows = vi.hoisted(() => new Map<string, Row>())
const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findUnique: vi.fn(({ where }: { where: { jobName: string } }) => Promise.resolve(rows.get(where.jobName) ?? null)),
    update: vi.fn(({ where, data }: { where: { jobName: string }; data: Partial<Row> }) => {
      Object.assign(rows.get(where.jobName)!, data)
      return Promise.resolve({})
    }),
    findMany: vi.fn(() =>
      Promise.resolve([...rows.entries()].filter(([, row]) => row.resumeReason === 'waiting').map(([jobName, row]) => ({ jobName, resumeAt: row.resumeAt }))),
    ),
  },
}))
// Three steps keep the cases short; the real chains are checked under "definitions"
vi.mock('./chainDefinitions.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./chainDefinitions.js')>()),
  CHAINS: { daily_edition_chain: ['select_stories', 'research_stories', 'publish_stories'] },
}))
const mockRunJob = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./scheduler.js', () => ({ runJob: mockRunJob }))
vi.mock('./handlers.js', () => ({
  JOB_HANDLERS: { select_stories: vi.fn(), research_stories: vi.fn(), publish_stories: vi.fn() },
}))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))

const { runChain, startStep, canContinue, holdUntil, resumeHeldChains, clearHeldChains } = await import('./chains.js')
const { nextClockTime, chainOf, CHAINS } = await vi.importActual<typeof import('./chainDefinitions.js')>('./chainDefinitions.js')
const { config } = await import('../config.js')

const STEPS = ['select_stories', 'research_stories', 'publish_stories']
const step = (overrides: Partial<Row> = {}): Row => ({
  enabled: true,
  pauseForReview: false,
  notBefore: null,
  interruptedRuns: 0,
  resumeStep: null,
  resumeReason: null,
  resumeAt: null,
  chainStartedAt: null,
  ...overrides,
})
const chain = () => rows.get('daily_edition_chain')!
const ranSteps = () => mockRunJob.mock.calls.map(([name]) => name as string)

describe('chains', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows.clear()
    rows.set('daily_edition_chain', step())
    for (const name of STEPS) rows.set(name, step())
    mockRunJob.mockResolvedValue({ result: 'succeeded' })
  })

  it('runs every step in order and ends with nothing to resume', async () => {
    await runChain('daily_edition_chain')
    expect(ranSteps()).toEqual(STEPS)
    expect(chain()).toMatchObject({ resumeStep: null, resumeReason: null })
  })

  it('skips a step that is off and runs the next on what there is', async () => {
    rows.get('research_stories')!.enabled = false
    await runChain('daily_edition_chain')
    expect(ranSteps()).toEqual(['select_stories', 'publish_stories'])
  })

  it('stops at a failed step: nothing after it runs, the chain fails with its error and can resume from it', async () => {
    mockRunJob.mockImplementation(async (name: string) => (name === 'research_stories' ? { result: 'failed', error: 'Tavily down' } : { result: 'succeeded' }))

    await expect(runChain('daily_edition_chain')).rejects.toThrow(/Stopped at research_stories.*Tavily down/)

    expect(ranSteps()).toEqual(['select_stories', 'research_stories'])
    expect(chain()).toMatchObject({ resumeStep: 'research_stories', resumeReason: 'failed' })
    expect(canContinue('daily_edition_chain', chain())).toBe(true)
  })

  it('waits for review after a step set to Review, with a notice, and Continue goes on from the next step', async () => {
    rows.get('select_stories')!.pauseForReview = true

    await runChain('daily_edition_chain')
    expect(ranSteps()).toEqual(['select_stories'])
    expect(chain()).toMatchObject({ resumeStep: 'research_stories', resumeReason: 'review' })
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', dedupeKey: 'chain-review:daily_edition_chain' }))

    mockRunJob.mockClear()
    await runChain('daily_edition_chain', 'continue')
    expect(ranSteps()).toEqual(['research_stories', 'publish_stories'])
    expect(chain()).toMatchObject({ resumeStep: null, resumeReason: null })
  })

  it('a review pause on the last step has nothing to wait for', async () => {
    rows.get('publish_stories')!.pauseForReview = true
    await runChain('daily_edition_chain')
    expect(chain().resumeReason).toBeNull()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('a scheduled run after a pause starts from the first step again', async () => {
    Object.assign(chain(), { resumeStep: 'publish_stories', resumeReason: 'review' })
    await runChain('daily_edition_chain')
    expect(ranSteps()).toEqual(STEPS)
  })

  it('resumes from the step it was in when its last run was cut off by a restart', async () => {
    Object.assign(chain(), { resumeStep: 'research_stories', resumeReason: 'running', interruptedRuns: 1 })
    await runChain('daily_edition_chain')
    expect(ranSteps()).toEqual(['research_stories', 'publish_stories'])
  })

  it('refuses Continue with nothing to continue', async () => {
    await expect(runChain('daily_edition_chain', 'continue')).rejects.toThrow(/nothing to continue/)
    expect(mockRunJob).not.toHaveBeenCalled()
  })

  it('waits for a step already running, then runs it', async () => {
    const original = { ...config.chains }
    config.chains.stepWaitPollMs = 1
    try {
      mockRunJob.mockResolvedValueOnce({ result: 'succeeded' }).mockResolvedValueOnce({ result: 'skipped' }).mockResolvedValue({ result: 'succeeded' })
      await runChain('daily_edition_chain')
      expect(ranSteps()).toEqual(['select_stories', 'research_stories', 'research_stories', 'publish_stories'])
    } finally {
      Object.assign(config.chains, original)
    }
  })

  it('stops when a step stays running elsewhere past the wait', async () => {
    const original = { ...config.chains }
    Object.assign(config.chains, { stepWaitMinutes: 0, stepWaitPollMs: 1 })
    try {
      mockRunJob.mockResolvedValue({ result: 'skipped' })
      await expect(runChain('daily_edition_chain')).rejects.toThrow(/still running/)
      expect(chain()).toMatchObject({ resumeStep: 'select_stories', resumeReason: 'failed' })
    } finally {
      Object.assign(config.chains, original)
    }
  })

  describe('a step held until its time', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-16T23:00:00Z'))
      rows.get('publish_stories')!.notBefore = '11:30'
    })
    afterEach(() => {
      clearHeldChains()
      vi.useRealTimers()
    })

    it('holds the chain before the step, lets the run end, and goes on by itself at the time', async () => {
      await runChain('daily_edition_chain')
      expect(ranSteps()).toEqual(['select_stories', 'research_stories'])
      expect(chain()).toMatchObject({ resumeStep: 'publish_stories', resumeReason: 'waiting', resumeAt: new Date('2026-11-17T11:30:00Z') })
      expect(canContinue('daily_edition_chain', chain())).toBe(true)

      // At the time, the chain goes on through the scheduler, from the held step
      mockRunJob.mockClear()
      mockRunJob.mockImplementation(async (name: string, handler: () => Promise<void>) => {
        if (name === 'daily_edition_chain') await handler()
        return { result: 'succeeded' }
      })
      await vi.advanceTimersByTimeAsync(12.5 * 3600_000)
      expect(ranSteps()).toEqual(['daily_edition_chain', 'publish_stories'])
      expect(chain()).toMatchObject({ resumeStep: null, resumeReason: null })
    })

    it('runs the step at once when the chain reaches it after its time', async () => {
      rows.get('publish_stories')!.notBefore = '23:30'
      mockRunJob.mockImplementation(async () => {
        vi.setSystemTime(new Date('2026-11-17T00:00:00Z'))
        return { result: 'succeeded' }
      })
      await runChain('daily_edition_chain')
      expect(ranSteps()).toEqual(STEPS)
    })

    it('runs the held step now when a person continues the chain', async () => {
      await runChain('daily_edition_chain')
      mockRunJob.mockClear()
      await runChain('daily_edition_chain', 'continue')
      expect(ranSteps()).toEqual(['publish_stories'])
      expect(chain().resumeReason).toBeNull()
    })

    it('sets a held chain going again at startup, at once when its time has passed', async () => {
      Object.assign(chain(), { resumeStep: 'publish_stories', resumeReason: 'waiting', resumeAt: new Date('2026-11-16T11:30:00Z'), enabled: true })
      mockRunJob.mockImplementation(async (name: string, handler: () => Promise<void>) => {
        if (name === 'daily_edition_chain') await handler()
        return { result: 'succeeded' }
      })
      await resumeHeldChains()
      await vi.advanceTimersByTimeAsync(0)
      expect(ranSteps()).toEqual(['daily_edition_chain', 'publish_stories'])
    })

    it('leaves a chain alone at the time when a person went on or switched it off meanwhile', async () => {
      await runChain('daily_edition_chain')
      mockRunJob.mockClear()
      chain().enabled = false
      await vi.advanceTimersByTimeAsync(12.5 * 3600_000)
      expect(mockRunJob).not.toHaveBeenCalled()
    })

    it('counts the hold from the run’s start, so a late step never waits a whole day', () => {
      const at = (iso: string) => new Date(iso)
      expect(holdUntil('11:30', at('2026-11-16T23:00:00Z'), at('2026-11-17T02:00:00Z'))).toEqual(at('2026-11-17T11:30:00Z'))
      expect(holdUntil('11:30', at('2026-11-16T23:00:00Z'), at('2026-11-17T12:00:00Z'))).toBeNull()
      expect(holdUntil(null, at('2026-11-16T23:00:00Z'), at('2026-11-17T02:00:00Z'))).toBeNull()
    })
  })

  describe('startStep', () => {
    it('starts a run at the first step unless it resumes an interrupted one; Continue only after a pause or a stop', () => {
      const row = (resumeStep: string | null, resumeReason: string | null, interruptedRuns = 0) => ({ resumeStep, resumeReason, interruptedRuns })
      expect(startStep(STEPS, row(null, null), 'start')).toBe(0)
      expect(startStep(STEPS, row('publish_stories', 'running', 0), 'start')).toBe(0)
      expect(startStep(STEPS, row('publish_stories', 'running', 1), 'start')).toBe(2)
      expect(startStep(STEPS, row('publish_stories', 'review'), 'continue')).toBe(2)
      expect(startStep(STEPS, row('research_stories', 'failed'), 'continue')).toBe(1)
      expect(startStep(STEPS, row('publish_stories', 'waiting'), 'continue')).toBe(2)
      expect(startStep(STEPS, row('publish_stories', 'waiting'), 'start')).toBe(0)
      // A cut-off social post is not posted again: the chain goes on after it (here, to its end)
      const withPost = [...STEPS, 'social_auto_post']
      expect(startStep(withPost, row('social_auto_post', 'running', 1), 'start')).toBe(4)
      expect(startStep(STEPS, row('research_stories', 'running'), 'continue')).toBeNull()
      expect(startStep(STEPS, row('no_such_step', 'failed'), 'continue')).toBeNull()
    })
  })

  describe('definitions', () => {
    it('makes each job a step of one chain at most, and no chain a step', () => {
      const steps = Object.values(CHAINS).flat()
      expect(new Set(steps).size).toBe(steps.length)
      for (const name of Object.keys(CHAINS)) expect(chainOf(name)).toBeNull()
      expect(chainOf('research_stories')).toBe('daily_edition_chain')
      expect(chainOf('social_auto_post')).toBe('daily_edition_chain')
      // Crawling runs on its own, several times a day
      expect(chainOf('crawl_feeds')).toBeNull()
      expect(chainOf('generate_newsletter')).toBeNull()
    })

    it('finds the next moment at a time of day, UTC, after the start', () => {
      const at = (iso: string) => new Date(iso)
      expect(nextClockTime('03:30', at('2026-11-16T23:00:00Z'))).toEqual(at('2026-11-17T03:30:00Z'))
      expect(nextClockTime('05:00', at('2026-11-17T01:00:00Z'))).toEqual(at('2026-11-17T05:00:00Z'))
      expect(nextClockTime('05:00', at('2026-11-17T05:00:00Z'))).toEqual(at('2026-11-18T05:00:00Z'))
      expect(nextClockTime(null, at('2026-11-17T05:00:00Z'))).toBeNull()
      expect(nextClockTime('5am', at('2026-11-17T05:00:00Z'))).toBeNull()
    })
  })
})
