/**
 * The card gate's split from research passes' (`cardGate.ts`; `.context/research-passes.md`, "How the
 * switch stays off"): with research passes' gate and overviews' open and the card gate closed, both
 * steps may still be switched on, and only what readers get of a pass's cards is held back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockJobRun = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('../lib/prisma.js', () => ({ default: { jobRun: mockJobRun } }))
vi.mock('./researchPassGate.js', () => ({ PASS_EVAL_GATE: null }))
vi.mock('./overviewGate.js', () => ({ OVERVIEW_EVAL_GATE: null }))
vi.mock('./cardGate.js', () => ({ CARD_EVAL_GATE: 'their evals are pending' }))

const { jobEnableConflict, jobEnableRefusal } = await import('../jobs/jobEnableChecks.js')
const { passStepOn, passSwitchRefusal } = await import('./researchPassQueue.js')
const { overviewSwitchRefusal } = await import('./overviewQueue.js')
const { readersRefusal } = await import('./storyCards.js')

const PASS_CARDS = { pass: { id: 'pass-1', number: 1, writtenAt: new Date('2026-11-28T02:00:00Z') } }

describe('the card gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('holds back a pass’s cards from readers, and no context run’s', () => {
    expect(readersRefusal(PASS_CARDS)).toMatch(/stay off the story page: their evals are pending/)
    expect(readersRefusal({ pass: null })).toBeNull()
    expect(readersRefusal(PASS_CARDS, null)).toBeNull()
  })

  it('holds no switch: research passes and overviews may be enabled while it is closed', async () => {
    expect(passSwitchRefusal()).toBeNull()
    expect(jobEnableRefusal('research_pass')).toBeNull()
    expect(overviewSwitchRefusal()).toBeNull()
    expect(jobEnableRefusal('link_overviews')).toBeNull()

    mockJobRun.findUnique.mockResolvedValue({ enabled: true })
    expect(await passStepOn()).toBe(true)
    expect(await jobEnableConflict('link_overviews')).toBeNull()
  })
})
