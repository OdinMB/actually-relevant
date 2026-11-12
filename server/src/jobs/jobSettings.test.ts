import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMode = vi.hoisted(() => vi.fn())
vi.mock('../services/researchApply.js', () => ({ pipelineMode: mockMode }))

const { jobSetting } = await import('./jobSettings.js')
const { config } = await import('../config.js')

describe('jobSetting', () => {
  beforeEach(() => {
    mockMode.mockReset()
  })

  it('names the cleanup cutoff from config', () => {
    expect(jobSetting('cleanup_old_stories')).toBe(`Stories older than ${config.storyRetention.maxAgeMonths} months`)
  })

  it('names the research step’s mode in effect, whether publishing waits, its per-run limit, and why apply is held back', () => {
    const perRun = `up to ${config.research.pipeline.perRun} stories a run`
    mockMode.mockReturnValue({ mode: 'shadow' })
    expect(jobSetting('research_stories')).toBe(`Shadow mode: runs are stored, no verdict is applied, publishing does not wait; ${perRun}`)
    mockMode.mockReturnValue({ mode: 'apply' })
    expect(jobSetting('research_stories')).toBe(
      `Apply mode: verdicts are applied, publishing holds stories selected under ${config.research.pipeline.maxWaitMinutes} min ago; a run while disabled is a shadow trial; ${perRun}`,
    )
    mockMode.mockReturnValue({ mode: 'shadow', heldBack: 'RESEARCH_APPLY_ENABLED is not "true"' })
    expect(jobSetting('research_stories')).toBe(`Shadow mode, apply held back (RESEARCH_APPLY_ENABLED is not "true"): publishing does not wait; ${perRun}`)
  })

  it('is null for a job without a setting to show', () => {
    expect(jobSetting('crawl_feeds')).toBeNull()
  })
})
