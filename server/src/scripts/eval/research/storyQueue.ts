/**
 * Runs the sample's stories a few at a time under the budget: a story starts only while the
 * folder's spend plus the estimates of the stories still running leaves room for its own estimate.
 * When it does not and nothing else runs, the run stops cleanly and the stories left are reported
 * as skipped (the live budget guard in `models.ts` stays the hard stop behind this).
 */

export interface SkippedStory {
  storyId: string
  reason: string
}

export interface RunStoriesOptions<S, R> {
  concurrency: number
  budgetUsd: number
  /** The folder's spend so far: model ledger plus Tavily credits. */
  spentUsd: () => number
  /** What a story may cost, reserved while it runs. */
  storyUsd: (story: S) => number
  run: (story: S) => Promise<R>
  /** Called as each story finishes, with the count finished so far. */
  onDone?: (story: S, result: R, finished: number) => void
}

const usd = (v: number) => `$${v.toFixed(4)}`

export async function runStories<S extends { id: string }, R>(stories: S[], o: RunStoriesOptions<S, R>): Promise<{ results: R[]; skipped: SkippedStory[] }> {
  const finished: { index: number; result: R }[] = []
  const skipped: SkippedStory[] = []
  let next = 0
  let running = 0
  let reserved = 0
  let stopped = false

  async function worker(): Promise<void> {
    while (!stopped && next < stories.length) {
      const index = next
      const story = stories[index]!
      const need = o.storyUsd(story)
      const left = o.budgetUsd - o.spentUsd() - reserved
      if (left < need) {
        // Stories still running hold budget they may not use: leave this one to a worker they free.
        if (running > 0) return
        stopped = true
        for (const s of stories.slice(index)) skipped.push({ storyId: s.id, reason: `budget: ${usd(left)} left, a story may need ${usd(need)}` })
        return
      }
      next++
      running++
      reserved += need
      try {
        const result = await o.run(story)
        finished.push({ index, result })
        o.onDone?.(story, result, finished.length)
      } finally {
        running--
        reserved -= need
      }
    }
  }

  const workers = Math.max(1, Math.min(o.concurrency, stories.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return { results: finished.sort((a, b) => a.index - b.index).map(f => f.result), skipped }
}
