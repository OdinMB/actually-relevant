import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSwitchRefusal = vi.hoisted(() => vi.fn())
vi.mock('../services/researchRuns.js', () => ({ switchRefusal: mockSwitchRefusal }))

const { jobSetting } = await import('./jobSettings.js')
const { config } = await import('../config.js')

describe('jobSetting', () => {
  beforeEach(() => {
    mockSwitchRefusal.mockReset().mockReturnValue(null)
  })

  it('names the cleanup cutoff from config', () => {
    expect(jobSetting('cleanup_old_stories')).toBe(`Stories older than ${config.storyRetention.maxAgeMonths} months`)
  })

  const { perRun: n, concurrency, maxWaitMinutes } = config.research.pipeline
  const limits = `up to ${n} stories a run, ${concurrency} at once`

  it('names the research step’s longest publish hold and its limits while research is switched on, with no other setting', () => {
    const setting = jobSetting('research_stories')
    expect(setting).toContain(`${maxWaitMinutes} min`)
    expect(setting).toContain(limits)
  })

  it('leads with why the research step does nothing while research is switched off, and names no publish hold', () => {
    mockSwitchRefusal.mockReturnValue('Research is switched off: TAVILY_API_KEY is not set')
    const setting = jobSetting('research_stories')
    expect(setting).toMatch(/^Research is switched off: TAVILY_API_KEY is not set/)
    expect(setting).not.toContain(`${maxWaitMinutes} min`)
    expect(setting).toContain(limits)
  })

  it('is null for a job without a setting to show', () => {
    expect(jobSetting('crawl_feeds')).toBeNull()
  })
})
