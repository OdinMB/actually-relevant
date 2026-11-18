/**
 * The fetch every OpenAI client in the server sends its requests through (`createChatModel`, the
 * embedding client). Inside a job run (`lib/runUsage.ts`) it does two things; outside one it only
 * passes the request on.
 *
 * - **Flex**: while the run's job has its Flex switch on and the chain's flex cut-off has not passed,
 *   a model request (Chat Completions or Responses, not streamed) is sent with `service_tier: "flex"`.
 *   A 429 to a flex request (OpenAI busy, not charged) is tried again at flex after a pause, up to
 *   `config.llm.flex.attempts` tries in all, then sent unchanged, at standard price, so a busy period
 *   costs more but never fails a run. Embeddings always go at standard price.
 * - **Usage**: the tokens of each answered request are read from a copy of the response and recorded
 *   in the run, at the tier OpenAI says it answered at.
 *
 * The SDK's own retries (`maxRetries`) sit around this: each of its attempts comes through here again.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { currentRun, flexNow, recordCall, track, type RunScope } from '../lib/runUsage.js'

const log = createLogger('openai-fetch')

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

/** What kind of OpenAI request a URL is: a model call, an embedding, or something else. */
export function requestKind(url: string): 'model' | 'embedding' | null {
  const path = url.split('?')[0] ?? ''
  if (/\/(chat\/completions|responses)$/.test(path)) return 'model'
  if (/\/embeddings$/.test(path)) return 'embedding'
  return null
}

function urlOf(input: FetchInput): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonBody(init: FetchInit): Record<string, unknown> | null {
  if (typeof init?.body !== 'string') return null
  try {
    const body: unknown = JSON.parse(init.body)
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** The token counts of a Chat Completions, Responses or Embeddings answer: cache reads (`cached`) and writes (`cacheWrite`) are parts of `input`. */
export function tokensOf(json: unknown): { input: number; cached: number; cacheWrite: number; output: number } {
  const usage = (json as { usage?: Record<string, unknown> } | null)?.usage
  if (!usage) return { input: 0, cached: 0, cacheWrite: 0, output: 0 }
  // Chat Completions and Embeddings: prompt_/completion_tokens; Responses: input_/output_tokens
  const input = num(usage.prompt_tokens ?? usage.input_tokens)
  const details = (usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined
  return {
    input,
    cached: num(details?.cached_tokens),
    cacheWrite: num(details?.cache_write_tokens),
    output: num(usage.completion_tokens ?? usage.output_tokens),
  }
}

/** Record the answered request's tokens in the run, read from a copy so the SDK still gets the body. */
function observe(scope: RunScope, res: Response, model: string, fellBack: boolean): void {
  if (!res.ok) return
  const copy = res.clone()
  track(
    scope,
    copy
      .json()
      .then((json: unknown) => {
        const tier = (json as { service_tier?: unknown } | null)?.service_tier === 'flex' ? 'flex' : 'standard'
        recordCall(scope, { model, tier, fellBack, ...tokensOf(json) })
      })
      .catch((err: unknown) => log.warn({ err, jobName: scope.jobName }, 'could not read the usage of an OpenAI answer')),
  )
}

/** A drop-in `fetch` for the OpenAI SDK: flex and usage recording inside a job run. */
export async function openAiFetch(input: FetchInput, init?: FetchInit): Promise<Response> {
  const scope = currentRun()
  const kind = requestKind(urlOf(input))
  if (!scope || !kind) return fetch(input, init)

  const body = jsonBody(init)
  const model = typeof body?.model === 'string' ? body.model : 'unknown'
  let fellBack = false

  if (kind === 'model' && body && body.stream !== true && flexNow(scope)) {
    const flexInit = { ...init, body: JSON.stringify({ ...body, service_tier: 'flex' }) }
    const { attempts, retryDelaysMs } = config.llm.flex
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const res = await fetch(input, flexInit)
      if (res.status !== 429) {
        observe(scope, res, model, false)
        return res
      }
      await res.body?.cancel().catch(() => {})
      // Past the cut-off meanwhile, or out of tries: standard price from here
      if (attempt === attempts || !flexNow(scope)) break
      await sleep(retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 0)
      if (!flexNow(scope)) break
    }
    fellBack = true
    log.info({ jobName: scope.jobName, model }, 'flex call refused as busy; sending it at standard price')
  }

  const res = await fetch(input, init)
  observe(scope, res, model, fellBack)
  return res
}
