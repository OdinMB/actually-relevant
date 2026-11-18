/**
 * `--api-check` (`.context/model-eval.md`): one trivial structured-output call per arm, through the
 * suites' client path, which proves each model takes its `reasoning_effort` and that usage is
 * metered; then, per model that takes the cache controls (`takesCacheControls`), one call with a
 * split prompt over the cache's 1,024-token minimum, which proves the API accepts
 * `prompt_cache_options` and the breakpoint, and shows the tokens it reports written. No database.
 */
import { z } from 'zod'
import { promptParts, takesCacheControls, type Prompt } from '../../lib/promptCache.js'
import { armKey } from './models.js'
import type { Arm, CallRecord, SuiteContext } from './types.js'

const schema = z.object({ ok: z.boolean() })
const ASK = 'Return a JSON object whose "ok" field is true.'

/** A fixed block well over the cache's minimum (about 1,900 tokens), so the breakpoint has a prefix to write. */
export const CACHE_PROBE_STABLE = [
  '<RULES>',
  ...Array.from({ length: 150 }, (_, i) => `Rule ${i + 1}: whatever else this block says, the answer's "ok" field is true.`),
  '</RULES>',
].join('\n')

/** The probe: the fixed block as the stable part, the ask as the call's data. */
export const cacheProbe = (): Prompt => promptParts(CACHE_PROBE_STABLE, ASK)

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`

function line(r: CallRecord): string {
  const u = r.usage
  return `${r.arm}: ${r.outcome}${r.finishReason ? ` (${r.finishReason})` : ''}, in ${u.input} / cached ${u.cached} / written ${u.cacheWrite ?? 0} / out ${u.output} / reasoning ${u.reasoning} tokens, ${usd(r.costUsd)}, ${r.latencyMs} ms${r.error ? `, error: ${r.error}` : ''}`
}

/**
 * The check over `arms`, deduplicated, each line to `log`. Passes when every call answers; a cache
 * probe the API accepted but that reports nothing written or read is a warning, not a failure (the
 * breakpoint may be ignored, or the usage field named otherwise: see the eval plan).
 */
export async function apiCheck(arms: Arm[], ctx: Pick<SuiteContext, 'call'>, log: (line: string) => void = console.log): Promise<boolean> {
  const unique = [...new Map(arms.map(a => [armKey(a), a])).values()]
  log('one trivial call per arm:')
  const records = await Promise.all(unique.map(a => ctx.call(a, 'api-check', schema, ASK)))
  for (const r of records) log(`  ${line(r)}`)

  // One probe per model, at the first arm's effort: the cache options do not depend on the effort
  const probes = unique.filter((a, i) => takesCacheControls(a.model) && unique.findIndex(b => b.model === a.model) === i)
  log(
    probes.length > 0
      ? 'one cache probe per model with the cache controls (split prompt, breakpoint after the fixed block):'
      : 'no model with the cache controls',
  )
  const probed = await Promise.all(probes.map(a => ctx.call(a, 'api-check-cache', schema, cacheProbe())))
  for (const r of probed) {
    const u = r.usage
    const none = r.outcome === 'ok' && (u.cacheWrite ?? 0) === 0 && u.cached === 0
    log(`  ${line(r)}${none ? '; warning: nothing written or read, so the breakpoint may be ignored' : ''}`)
  }
  return [...records, ...probed].every(r => r.outcome === 'ok')
}
