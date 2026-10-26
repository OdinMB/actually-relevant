/**
 * The `network` case's Node probe: one GET from the run's own process. In the run's environment
 * Node's fetch sends it to the proxy sink (NODE_USE_ENV_PROXY), which drops it, so it must fail.
 */
import { GUARD_TEST_NETWORK_URL } from './guard.mjs'

export async function probeFromNode({ timeoutMs, url = GUARD_TEST_NETWORK_URL }) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    await response.body?.cancel()
    return { from: 'Node', reached: true, detail: `HTTP ${response.status}` }
  } catch (err) {
    const cause = err?.cause
    const detail = cause?.code ?? (cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err))
    return { from: 'Node', reached: false, detail: String(detail).split('\n')[0] }
  }
}
