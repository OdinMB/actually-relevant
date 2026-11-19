import { describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { reviewSchema } from '../schemas/overviews.js'
import { OVERVIEW_STEPS, overviewCalls, type OverviewStep } from './overviewSteps.js'
import type { LinkStory } from './overviewTypes.js'

const story: LinkStory = {
  id: 's1',
  title: 'Title',
  label: 'Label',
  summary: 'Summary.',
  datePublished: new Date('2026-06-01T00:00:00Z'),
  date: '2026-06-01',
  issueId: null,
  facts: [],
}

describe('overviewCalls', () => {
  it('makes each call at its step, with the prompt its builder writes, the audit as the review at high effort', async () => {
    const seen: { step: OverviewStep<unknown>; text: string }[] = []
    const call = vi.fn(async (step: OverviewStep<unknown>, prompt: unknown) => {
      seen.push({ step, text: JSON.stringify(prompt) })
      return { parsed: null, costUsd: 0, model: 'm' }
    })
    const calls = overviewCalls(call)
    const charter = { in: 'In.', out: [], endEvent: 'Declared over.' }
    const entries = [{ ref: 'E1', title: 'T', label: 'L', summary: 'S.', date: '2026-06-01', role: { role: 'routine' as const, roleKind: null } }]
    await calls.close.close({ charter, story, entries: [] })
    await calls.close.closeCheck({ endEvent: charter.endEvent, story })
    await calls.review.review({ title: 'Review title', charter, frozen: false, entries }, { audit: false })
    await calls.review.review({ title: 'Audit title', charter, frozen: false, entries }, { audit: true })
    await calls.stands.write({ title: 'Stands title', entries: [], facts: [], today: '2026-06-02', maxSentences: 4, maxDoing: 2 })
    await calls.stands.check([], [])
    expect(seen.map(s => s.step)).toEqual([
      OVERVIEW_STEPS.close,
      OVERVIEW_STEPS.closeCheck,
      OVERVIEW_STEPS.review,
      OVERVIEW_STEPS.audit,
      OVERVIEW_STEPS.stands,
      OVERVIEW_STEPS.standsCheck,
    ])
    expect(seen[2]!.text).toContain('Review title')
    expect(seen[3]!.text).toContain('Audit title')
    expect(seen[4]!.text).toContain('Stands title')
  })

  it('takes each tier from config, and gives only the audit an effort of its own', () => {
    const { tiers } = config.overviews
    expect(OVERVIEW_STEPS.link.tier).toBe(tiers.link)
    expect(OVERVIEW_STEPS.found.tier).toBe(tiers.found)
    expect(OVERVIEW_STEPS.standsCheck.tier).toBe(tiers.standsCheck)
    expect(OVERVIEW_STEPS.audit).toEqual({ ...OVERVIEW_STEPS.review, effort: 'high' })
    expect(OVERVIEW_STEPS.audit.schema).toBe(reviewSchema)
    expect(Object.entries(OVERVIEW_STEPS).filter(([, s]) => 'effort' in s)).toEqual([['audit', OVERVIEW_STEPS.audit]])
  })
})
