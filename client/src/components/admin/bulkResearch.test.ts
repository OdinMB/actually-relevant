import { describe, it, expect } from 'vitest'
import type { PassUsage, ResearchBulkApplyOutcome, ResearchUsage, TaskState } from '@shared/types'
import {
  bulkApplyConfirmation,
  bulkApplyOutcome,
  bulkApplyRefusal,
  bulkPassConfirmation,
  bulkPassOutcome,
  bulkPassRefusal,
  bulkResearchConfirmation,
  bulkResearchOutcome,
  bulkResearchRefusal,
  RESEARCH_BULK_MAX,
} from './bulkResearch'

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

describe('bulkApplyRefusal', () => {
  it('hides the action against a backend without research, and while its usage loads', () => {
    expect(bulkApplyRefusal(3, null, false)).toBeUndefined()
    expect(bulkApplyRefusal(3, undefined, false)).toBeUndefined()
  })

  it('gives the reason no run can be applied now, or none, whatever refuses a new run', () => {
    expect(bulkApplyRefusal(3, usage({ applyRefusal: 'Research is switched off' }), false)).toBe('Research is switched off')
    expect(bulkApplyRefusal(3, usage({ refusal: "This month's research cap is reached" }), false)).toBeNull()
  })

  it('refuses more stories than one bulk action takes, and an unknown usage, with a reason', () => {
    expect(bulkApplyRefusal(RESEARCH_BULK_MAX, usage(), false)).toBeNull()
    expect(bulkApplyRefusal(RESEARCH_BULK_MAX + 1, usage(), false)).toEqual(expect.any(String))
    expect(bulkApplyRefusal(3, undefined, true)).toEqual(expect.any(String))
  })
})

const passUsage = (over: Partial<PassUsage> = {}): PassUsage => ({
  spentUsd: 1,
  capUsd: 30,
  firstPassUsd: 0.4,
  laterPassUsd: 0.25,
  refusal: null,
  on: true,
  ...over,
})

describe('bulkPassRefusal', () => {
  it('leaves "Research again" out while the step is off, against a backend without passes, and while its usage loads', () => {
    expect(bulkPassRefusal(3, passUsage({ on: false }))).toBeUndefined()
    expect(bulkPassRefusal(3, passUsage({ on: false, refusal: 'Research passes are switched off' }))).toBeUndefined()
    expect(bulkPassRefusal(3, null)).toBeUndefined()
    expect(bulkPassRefusal(3, undefined)).toBeUndefined()
  })

  it('gives the reason no pass can start now, or none, and refuses more stories than one bulk takes', () => {
    expect(bulkPassRefusal(3, passUsage({ refusal: "This month's research cap is reached" }))).toBe("This month's research cap is reached")
    expect(bulkPassRefusal(RESEARCH_BULK_MAX, passUsage())).toBeNull()
    expect(bulkPassRefusal(RESEARCH_BULK_MAX + 1, passUsage())).toEqual(expect.any(String))
  })
})

describe('bulkPassConfirmation', () => {
  it('says the passes apply themselves, with the count and every pass at a first pass’s reservation as the bound', () => {
    const { title, description } = bulkPassConfirmation(10, passUsage())
    expect(title).toBe('Research 10 stories again?')
    expect(description).toMatch(/applies its own result/)
    expect(description).toContain('Undo this update')
    expect(description).toContain('$4.00')
    expect(description).toContain('This month: $1.00 of $30.00 spent.')
  })

  it("names what is left of the month's cap when the bound passes it", () => {
    expect(bulkPassConfirmation(10, passUsage({ spentUsd: 28 })).description).toContain('$2.00 left this month')
  })
})

describe('bulkPassOutcome', () => {
  const chosen = [
    { id: 's1', title: 'Floods in Kerala' },
    { id: 's2', title: 'Rail strike ends' },
  ]

  it('counts the stories researched, failed and skipped, names the skipped ones, and claims nothing about applying', () => {
    const { message, sticky } = bulkPassOutcome(
      'Researching 2 stories again',
      task({ completed: 1, skipped: [{ storyId: 's2', reason: 'A research pass of this story is in progress' }] }),
      chosen,
    )
    expect(message).toMatch(/1 researched.*1 skipped/)
    expect(message).toContain('Rail strike ends')
    expect(message).not.toMatch(/Nothing was applied/)
    expect(sticky).toBe(true)
  })

  it('fades when every story was researched', () => {
    expect(bulkPassOutcome('Researching 2 stories again', task({ completed: 2 }), chosen).sticky).toBe(false)
  })
})

describe('bulkApplyConfirmation', () => {
  it('names the count', () => {
    expect(bulkApplyConfirmation(12).title).toContain('12')
  })
})

describe('bulkApplyOutcome', () => {
  const chosen = [
    { id: 's1', title: 'Floods in Kerala' },
    { id: 's2', title: 'Rail strike ends' },
    { id: 's3', title: 'Vaccine rollout' },
    { id: 's4', title: 'Heat records' },
  ]
  const applied = (storyId: string): ResearchBulkApplyOutcome => ({ storyId, outcome: 'applied', runId: `run-${storyId}` })

  it('counts the stories applied, failed and skipped, names each not applied with its reason, and stays until dismissed', () => {
    const { type, message, sticky } = bulkApplyOutcome(
      'Applying 4',
      [
        applied('s1'),
        { storyId: 's2', outcome: 'skipped', reason: "Its newest run fell back to today's format" },
        { storyId: 's3', outcome: 'failed', reason: 'unexpected error (Error)' },
        applied('s4'),
      ],
      chosen,
    )
    expect(message).toMatch(/2 applied.*1 failed.*1 skipped/)
    expect(message).toMatch(/Rail strike ends.*fell back/)
    expect(message).toMatch(/Vaccine rollout.*unexpected error/)
    expect(message).not.toContain('Floods in Kerala')
    expect(type).toBe('error')
    expect(sticky).toBe(true)
  })

  it('fades like any outcome when every story took its version', () => {
    const { type, message, sticky } = bulkApplyOutcome('Applying 2', [applied('s1'), applied('s2')], chosen)
    expect(message).toMatch(/2 applied/)
    expect(message).not.toMatch(/skipped|failed/)
    expect(type).toBe('success')
    expect(sticky).toBe(false)
  })

  it('names at most ten skipped stories and counts the rest', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, title: `Story number ${i}` }))
    const { message } = bulkApplyOutcome(
      'Applying 13',
      many.map(s => ({ storyId: s.id, outcome: 'skipped' as const, reason: 'No research run yet' })),
      many,
    )
    expect(message).toContain('Story number 9')
    expect(message).not.toContain('Story number 10')
    expect(message).toMatch(/\b3 more\b/)
  })
})
