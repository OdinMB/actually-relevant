import { describe, it, expect } from 'vitest'
import { runStories } from './storyQueue.js'

const stories = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }))

/** A run whose stories each cost `cost` once they finish, recorded in a shared ledger. */
function ledger(cost: number) {
  let spent = 0
  let running = 0
  const state = { started: [] as string[], maxRunning: 0 }
  return {
    spentUsd: () => spent,
    get started() {
      return state.started
    },
    get maxRunning() {
      return state.maxRunning
    },
    run: async (s: { id: string }) => {
      state.started.push(s.id)
      running++
      state.maxRunning = Math.max(state.maxRunning, running)
      await new Promise(resolve => setTimeout(resolve, 1))
      spent += cost
      running--
      return `${s.id} done`
    },
  }
}

describe('runStories', () => {
  it('runs every story within the budget and keeps the input order', async () => {
    const l = ledger(0.1)
    const out = await runStories(stories(4), { concurrency: 2, budgetUsd: 1, spentUsd: l.spentUsd, storyUsd: () => 0.2, run: l.run })
    expect(out.results).toEqual(['s1 done', 's2 done', 's3 done', 's4 done'])
    expect(out.skipped).toEqual([])
  })

  it('stops before a story whose estimate would overrun the budget, and reports the rest as skipped', async () => {
    const l = ledger(0.25)
    const out = await runStories(stories(5), { concurrency: 1, budgetUsd: 1, spentUsd: l.spentUsd, storyUsd: () => 0.3, run: l.run })
    expect(l.started).toEqual(['s1', 's2', 's3'])
    expect(out.results).toHaveLength(3)
    expect(out.skipped.map(s => s.storyId)).toEqual(['s4', 's5'])
    expect(out.skipped[0]?.reason).toMatch(/budget/)
  })

  it('holds a story back while running stories reserve the budget, and starts it once they finish', async () => {
    const l = ledger(0.1)
    const out = await runStories(stories(4), { concurrency: 3, budgetUsd: 1, spentUsd: l.spentUsd, storyUsd: () => 0.4, run: l.run })
    // s1 and s2 reserve 0.8, so s3 cannot start beside them; each finish frees 0.3 of it
    expect(l.maxRunning).toBe(2)
    expect(out.results).toEqual(['s1 done', 's2 done', 's3 done', 's4 done'])
    expect(out.skipped).toEqual([])
  })

  it('starts nothing when the folder has spent its budget', async () => {
    const out = await runStories(stories(2), { concurrency: 2, budgetUsd: 1, spentUsd: () => 1, storyUsd: () => 0.01, run: async () => 'ran' })
    expect(out.results).toEqual([])
    expect(out.skipped).toHaveLength(2)
  })
})
