import { describe, it, expect } from 'vitest'
import type { ResearchUsage, TaskState } from '@shared/types'
import { bulkResearchConfirmation, bulkResearchOutcome, bulkResearchRefusal, RESEARCH_BULK_MAX } from './bulkResearch'

const usage = (over: Partial<ResearchUsage> = {}): ResearchUsage => ({
  enabled: true,
  refusal: null,
  applyRefusal: null,
  monthToDateUsd: 1,
  monthlyCapUsd: 30,
  reservationUsd: 0.25,
  ...over,
})

const task = (over: Partial<TaskState> = {}): TaskState => ({
  id: 'task-1',
  type: 'research',
  status: 'completed',
  total: 3,
  completed: 0,
  failed: 0,
  errors: [],
  skipped: [],
  storyIds: [],
  createdAt: '2026-11-14T10:00:00Z',
  ...over,
})

describe('bulkResearchRefusal', () => {
  it('hides the action against a backend without research, and while its usage loads', () => {
    expect(bulkResearchRefusal(3, null, false)).toBeUndefined()
    expect(bulkResearchRefusal(3, undefined, false)).toBeUndefined()
  })

  it('gives the reason research refuses every run now, or none', () => {
    expect(bulkResearchRefusal(3, usage({ refusal: "This month's research cap is reached" }), false)).toBe("This month's research cap is reached")
    expect(bulkResearchRefusal(3, usage(), false)).toBeNull()
  })

  it('refuses more stories than one bulk Research takes, with a reason', () => {
    expect(bulkResearchRefusal(RESEARCH_BULK_MAX, usage(), false)).toBeNull()
    expect(bulkResearchRefusal(RESEARCH_BULK_MAX + 1, usage(), false)).toEqual(expect.any(String))
  })

  it('keeps the action visible with a reason when the usage could not be loaded', () => {
    expect(bulkResearchRefusal(3, undefined, true)).toEqual(expect.any(String))
  })
})

describe('bulkResearchConfirmation', () => {
  it('names the count and the cost upper bound, every run at its reservation', () => {
    const { title, description } = bulkResearchConfirmation(12, usage({ reservationUsd: 0.25 }))
    expect(title).toContain('12')
    expect(description).toContain('$3.00')
  })

  it("names what is left of the month's cap only when the bound passes it", () => {
    expect(bulkResearchConfirmation(12, usage({ monthToDateUsd: 28, monthlyCapUsd: 30 })).description).toContain('$2.00')
    expect(bulkResearchConfirmation(4, usage({ monthToDateUsd: 1, monthlyCapUsd: 30 })).description).not.toContain('$29.00')
  })
})

describe('bulkResearchOutcome', () => {
  const chosen = [
    { id: 's1', title: 'Floods in Kerala' },
    { id: 's2', title: 'Rail strike ends' },
    { id: 's3', title: 'Vaccine rollout' },
  ]

  it('counts the stories researched, failed and skipped, names each skipped one with its reason, and stays until dismissed', () => {
    const { message, sticky } = bulkResearchOutcome(
      'Researching 3 stories',
      task({ completed: 1, failed: 1, skipped: [{ storyId: 's2', reason: 'A research run of this story is already in progress' }] }),
      chosen,
    )
    expect(message).toMatch(/1 researched.*1 failed.*1 skipped/)
    expect(message).toContain('Rail strike ends')
    expect(message).toContain('A research run of this story is already in progress')
    expect(message).not.toContain('Floods in Kerala')
    expect(sticky).toBe(true)
  })

  it('fades like any outcome when every story was researched', () => {
    const { message, sticky } = bulkResearchOutcome('Researching 3 stories', task({ completed: 3 }), chosen)
    expect(message).toMatch(/3 researched/)
    expect(message).not.toMatch(/skipped|failed/)
    expect(sticky).toBe(false)
  })

  it('names at most ten skipped stories and counts the rest', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: `Story number ${i}` }))
    const { message } = bulkResearchOutcome('Researching 13 stories', task({ skipped: many.map(s => ({ storyId: s.id, reason: 'Story not found' })) }), many)
    expect(message).toContain('Story number 9')
    expect(message).not.toContain('Story number 10')
    expect(message).toMatch(/\b3 more\b/)
  })

  it('reads a task from a backend that reports no skips as having none', () => {
    const { message } = bulkResearchOutcome('Researching 3 stories', task({ completed: 3, skipped: undefined }), chosen)
    expect(message).not.toMatch(/skipped/)
  })
})
