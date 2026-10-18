import { describe, it, expect } from 'vitest'
import { jobSetting } from './jobSettings.js'
import { config } from '../config.js'

describe('jobSetting', () => {
  it('names the cleanup cutoff from config', () => {
    expect(jobSetting('cleanup_old_stories')).toBe(`Stories older than ${config.storyRetention.maxAgeMonths} months`)
  })

  it('is null for a job without a setting to show', () => {
    expect(jobSetting('crawl_feeds')).toBeNull()
  })
})
