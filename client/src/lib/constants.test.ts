import { describe, it, expect } from 'vitest'
import { jobDisplayName, JOB_DISPLAY_NAMES, JOB_PIPELINE_ORDER } from './constants'

describe('jobDisplayName', () => {
  it('uses the label of every job this build knows', () => {
    for (const name of JOB_PIPELINE_ORDER) expect(jobDisplayName(name)).toBe(JOB_DISPLAY_NAMES[name])
  })

  it('title-cases a job id this build does not know instead of showing it raw', () => {
    expect(jobDisplayName('archive_old_stories')).toBe('Archive Old Stories')
  })
})
