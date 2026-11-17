import { describe, it, expect } from 'vitest'
import { emptyUsage } from '../lib/runUsage.js'
import { FAILURE_SHARE_MESSAGES, failureShareNotice } from './failureShare.js'

const usage = (itemsChecked: number, itemsFailed: number) => ({ ...emptyUsage(), itemsChecked, itemsFailed })

describe('failureShareNotice', () => {
  it("is one warning notice for the job, titled by its name, with the job's own message where it has one", () => {
    expect(failureShareNotice('build_story_context', usage(45, 14))).toEqual({
      source: 'jobs',
      severity: 'warning',
      title: 'Build Story Context: 14 of 45 checked items failed in the last run',
      message: FAILURE_SHARE_MESSAGES.build_story_context,
      link: '/admin/jobs',
      dedupeKey: 'step-failing:build_story_context',
    })
  })

  it('gives any other job whose run counts items the plain message', () => {
    expect(failureShareNotice('select_stories', usage(20, 5))).toMatchObject({
      title: 'Select Stories: 5 of 20 checked items failed in the last run',
      message: 'Its checks failed more of what it wrote than usual. Nothing paused; switch it off on the Jobs page if it keeps happening.',
      dedupeKey: 'step-failing:select_stories',
    })
  })

  it('words every message for the people who run the site: no setting, code or file names, at most one em dash', () => {
    const texts = ['build_story_context', 'select_stories'].map(job => failureShareNotice(job, usage(45, 14))!.message)
    for (const text of texts) {
      expect(text, text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|`|\w\(\)|\bconfig\.|\.(ts|js|md)\b/)
      expect(text.split('—').length - 1, text).toBeLessThanOrEqual(1)
    }
  })

  it('is none at exactly the share, under the least number of items, and for a run that counts none', () => {
    expect(failureShareNotice('build_story_context', usage(20, 4))).toBeNull()
    expect(failureShareNotice('build_story_context', usage(19, 19))).toBeNull()
    expect(failureShareNotice('build_story_context', emptyUsage())).toBeNull()
  })
})
