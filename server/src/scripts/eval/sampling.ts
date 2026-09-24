/**
 * Deterministic sampling rules for eval fixtures (pure; the SQL lives in fixtures.ts).
 */
import { createHash } from 'node:crypto'
import { splitIntoGroups } from '../../lib/utils.js'

export const EVAL_SALT = 'gpt6-eval'

/** Same value as Postgres `md5(id || 'gpt6-eval')`, so JS and SQL orderings agree. */
export function evalHash(id: string): string {
  return createHash('md5').update(id + EVAL_SALT).digest('hex')
}

export function byEvalHash<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => (evalHash(key(a)) < evalHash(key(b)) ? -1 : 1))
}

export interface Quota<T> {
  name: string
  test: (t: T) => boolean
  min: number
}

/**
 * Pick `total` items from `pool` (already in deterministic order): first fill
 * each quota in order, then round-robin across `spreadBy` groups. Shortfalls
 * are reported, never padded.
 */
export function stratifiedPick<T>(
  pool: T[],
  options: { total: number; quotas: Quota<T>[]; spreadBy: (t: T) => string },
): { picked: T[]; shortfalls: string[] } {
  const picked: T[] = []
  const taken = new Set<T>()
  const take = (t: T) => {
    picked.push(t)
    taken.add(t)
  }

  for (const quota of options.quotas) {
    let have = picked.filter(quota.test).length
    for (const t of pool) {
      if (have >= quota.min || picked.length >= options.total) break
      if (!taken.has(t) && quota.test(t)) {
        take(t)
        have++
      }
    }
  }

  const queues = new Map<string, T[]>()
  for (const t of pool) {
    if (taken.has(t)) continue
    const k = options.spreadBy(t)
    const queue = queues.get(k) ?? []
    queue.push(t)
    queues.set(k, queue)
  }
  const keys = [...queues.keys()].sort()
  while (picked.length < options.total && keys.some(k => (queues.get(k)?.length ?? 0) > 0)) {
    for (const k of keys) {
      if (picked.length >= options.total) break
      const next = queues.get(k)?.shift()
      if (next !== undefined) take(next)
    }
  }

  const shortfalls: string[] = []
  if (picked.length < options.total) shortfalls.push(`${picked.length} of ${options.total} items available`)
  for (const quota of options.quotas) {
    const have = picked.filter(quota.test).length
    if (have < quota.min) shortfalls.push(`${quota.name}: ${have} of ${quota.min}`)
  }
  return { picked, shortfalls }
}

export interface DatedStory {
  id: string
  dateCrawled: Date
}

export interface SelectionGroupDraft {
  id: string
  day: string
  storyIds: string[]
  toSelect: number
}

/**
 * Historical selection groups: bucket by UTC crawl day, keep days with at
 * least `minPerDay` stories, split each day like production
 * (`splitIntoGroups`), then take `count` groups in hash order.
 */
export function buildSelectionGroups(
  stories: DatedStory[],
  options: { minPerDay: number; maxGroupSize: number; ratio: number; count: number },
): SelectionGroupDraft[] {
  const days = new Map<string, DatedStory[]>()
  for (const s of stories) {
    const day = s.dateCrawled.toISOString().slice(0, 10)
    const bucket = days.get(day) ?? []
    bucket.push(s)
    days.set(day, bucket)
  }
  const groups: SelectionGroupDraft[] = []
  for (const [day, bucket] of days) {
    if (bucket.length < options.minPerDay) continue
    const ordered = [...bucket].sort((a, b) => a.dateCrawled.getTime() - b.dateCrawled.getTime() || (a.id < b.id ? -1 : 1))
    splitIntoGroups(ordered, options.maxGroupSize).forEach((group, i) => {
      groups.push({
        id: `${day}#${i + 1}`,
        day,
        storyIds: group.map(s => s.id),
        toSelect: Math.ceil(group.length * options.ratio),
      })
    })
  }
  return byEvalHash(groups, g => g.id).slice(0, options.count)
}
