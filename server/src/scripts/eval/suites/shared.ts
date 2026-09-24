/**
 * Plumbing shared by the suites: fan calls out across arms, and turn
 * per-arm metrics into report rows.
 */
import type { z } from 'zod'
import { armKey } from '../models.js'
import { summarizeCalls } from '../checks.js'
import type { Arm, ArmStats, CallRecord, MetricRow, SuiteContext } from '../types.js'

export function limited<T>(items: T[], limit?: number): T[] {
  return limit == null ? items : items.slice(0, limit)
}

export function parsedOf<T>(record: CallRecord<T> | undefined): T | null {
  return record?.outcome === 'ok' ? record.parsed : null
}

/** Every item × arm, concurrently (the context's semaphore bounds concurrency). */
export async function runArms<I, T>(
  ctx: SuiteContext,
  arms: Arm[],
  items: I[],
  schemaName: string,
  schema: z.ZodType<T>,
  prompt: (item: I) => string,
): Promise<Map<string, CallRecord<T>[]>> {
  const entries = await Promise.all(
    arms.map(async a => [armKey(a), await Promise.all(items.map(item => ctx.call(a, schemaName, schema, prompt(item))))] as const),
  )
  return new Map(entries)
}

/** One call at a time, arms interleaved per item, so latency is measured without contention. */
export async function runArmsSequentially<I, T>(
  ctx: SuiteContext,
  arms: Arm[],
  items: I[],
  schemaName: string,
  schema: z.ZodType<T>,
  prompt: (item: I) => string,
): Promise<Map<string, CallRecord<T>[]>> {
  const out = new Map<string, CallRecord<T>[]>(arms.map(a => [armKey(a), []]))
  for (const item of items) {
    for (const a of arms) {
      out.get(armKey(a))?.push(await ctx.call(a, schemaName, schema, prompt(item)))
    }
  }
  return out
}

export function statsFor(records: Map<string, CallRecord[]>): ArmStats[] {
  return [...records.entries()].map(([key, recs]) => summarizeCalls(key, recs))
}

export function metricRow<M>(
  name: string,
  metrics: Record<string, M>,
  get: (m: M) => number | null,
  format: (v: number | null) => string,
  better?: 'higher' | 'lower',
): MetricRow {
  const raw = Object.fromEntries(Object.entries(metrics).map(([k, m]) => [k, get(m)]))
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, format(v)]))
  return { name, values, raw, ...(better ? { better } : {}) }
}

/** Quote untrusted text as a markdown blockquote. */
export function blockquote(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}
