import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// Every list that names jobs names jobs that exist, and every job is where a new one must go
// (`.context/scheduler.md`, "Adding a New Job"): a job missing from one of them fails here, not at its
// first scheduled run.
vi.mock('../lib/prisma.js', () => ({ default: {} }))

const { JOB_HANDLERS, JOB_PIPELINE_ORDER } = await import('./handlers.js')
const { CHAINS } = await import('./chainDefinitions.js')
const { MODEL_JOBS } = await import('./modelJobs.js')
const { RESUMABLE_JOBS } = await import('./interruptedRuns.js')
const { ENABLE_CHECKS } = await import('./jobEnableChecks.js')
const { NOTES, WARNINGS } = await import('./jobNotes.js')

const JOBS = Object.keys(JOB_HANDLERS)

/** The job names `seed-jobs.ts` creates rows for (a script: reading it runs it, so its text is read). */
const seeded = () => [...readFileSync(new URL('../scripts/seed-jobs.ts', import.meta.url), 'utf8').matchAll(/create: \{ jobName: '([a-z_]+)'/g)].map(m => m[1]!)

describe('the job lists', () => {
  it('give every job with a handler its place in the boot catch-up order, once', () => {
    expect([...JOB_PIPELINE_ORDER].sort()).toEqual([...JOBS].sort())
  })

  it('seed a row for every job with a handler, and none for a job without one', () => {
    expect(seeded().sort()).toEqual([...JOBS].sort())
  })

  it('give every chain a handler and a resume, and every chain step a handler, in one chain at most', () => {
    const steps = Object.values(CHAINS).flat()
    for (const chain of Object.keys(CHAINS)) {
      expect(JOBS, chain).toContain(chain)
      expect(RESUMABLE_JOBS.has(chain), chain).toBe(true)
    }
    for (const step of steps) expect(JOBS, step).toContain(step)
    expect(new Set(steps).size).toBe(steps.length)
  })

  it.each([
    ['MODEL_JOBS', [...MODEL_JOBS]],
    ['RESUMABLE_JOBS', [...RESUMABLE_JOBS]],
    ['the enable checks', Object.keys(ENABLE_CHECKS)],
    ['the notes', Object.keys(NOTES)],
    ['the warnings', Object.keys(WARNINGS)],
  ])('name only jobs that exist: %s', (_list, names) => {
    for (const name of names) expect(JOBS, name).toContain(name)
  })
})
