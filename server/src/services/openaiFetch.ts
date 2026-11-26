/**
 * The fetch every OpenAI client in the server sends its requests through (`createChatModel`, the
 * embedding client). Inside a job run (`lib/runUsage.ts`) it does two things; outside one it only
 * passes the request on. Every attempt it sends, a flex try included, goes through `cappedFetch`
 * (`lib/openaiSpend.ts`): the global `fetch` unless an eval command installed a task spend cap.
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
import { tokensOf } from '../lib/llmUsage.js'
import { createLogger } from '../lib/logger.js'
import { cappedFetch, type OpenAiRequestKind } from '../lib/openaiSpend.js'
import { currentRun, flexNow, recordCall, track, type RunScope } from '../lib/runUsage.js'

const log = createLogger('openai-fetch')

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

/** What kind of OpenAI request a URL is: a model call, an embedding, or something else. */
export function requestKind(url: string): OpenAiRequestKind | null {
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
  const send = (sent: FetchInit) => cappedFetch(input, sent, kind)
  if (!scope || !kind) return send(init)

  const body = jsonBody(init)
  const model = typeof body?.model === 'string' ? body.model : 'unknown'
  let fellBack = false

  if (kind === 'model' && body && body.stream !== true && flexNow(scope)) {
    const flexInit = { ...init, body: JSON.stringify({ ...body, service_tier: 'flex' }) }
    const { attempts, retryDelaysMs } = config.llm.flex
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const res = await send(flexInit)
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

  const res = await send(init)
  observe(scope, res, model, fellBack)
  return res
}
