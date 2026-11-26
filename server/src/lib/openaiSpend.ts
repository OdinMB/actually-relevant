/**
 * The task spend cap at the OpenAI choke point (`lib/spendCap.ts`): what one request can cost at most,
 * read from its body alone, what it did cost, read from its answer, and the fetch `openAiFetch` sends
 * every attempt through, which reserves the first before the request leaves and settles the second
 * once it ends. With no guard installed, as in production, that fetch is the global `fetch` itself.
 *
 * The worst case is an upper bound, never an estimate: every input token is at least one byte of the
 * request body (JSON escaping only adds bytes), plus `INPUT_OVERHEAD_TOKENS` for what the API adds
 * around the messages, all billed at the dearest input price (a cache write); and as output the
 * lower of the request's own limit and the model's maximum (`lib/apiPrices.ts`), per answer asked
 * for, at the standard price (flex costs less). No limit is ever added to a request. A request whose
 * cost its body does not bound (a model or an embedding model with no price, an image, audio or a
 * file, context stored at OpenAI, a built-in tool, priority processing, another endpoint) is refused.
 */
import { EMBEDDING_PRICES, costOf, modelPrice, type ModelId } from './apiPrices.js'
import { tokensOf } from './llmUsage.js'
import {
  settledUsd,
  SPEND_CAP_REACHED_CODE,
  SPEND_REFUSED_CODE,
  spendGuard,
  spendRefusalOf,
  SpendRefused,
  type Reservation,
  type SpendGuard,
  type SpendRefusal,
} from './spendCap.js'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

/** A model call (Chat Completions or Responses) or an embedding; null for any other OpenAI request. */
export type OpenAiRequestKind = 'model' | 'embedding'

/** Tokens allowed above the body's bytes for the message framing and the preamble the API adds. */
export const INPUT_OVERHEAD_TOKENS = 1_024

export interface OpenAiBound {
  kind: OpenAiRequestKind
  model: string
  usd: number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const positiveInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

/** The content part types billed by their text alone. */
const TEXT_PARTS = new Set(['text', 'input_text', 'output_text', 'refusal'])

/** Why the body does not bound what the request is billed, or null when it does. */
function unboundedBy(body: Record<string, unknown>): string | null {
  if (body.service_tier === 'priority' || body.service_tier === 'scale') return 'asks for priority processing, billed above the standard price'
  if (body.previous_response_id != null || body.conversation != null || body.prompt != null) return 'carries context stored at OpenAI'
  if (Array.isArray(body.tools) && body.tools.some(t => !isRecord(t) || t.type !== 'function')) return 'uses a built-in tool, billed per use'
  if (body.audio != null || (Array.isArray(body.modalities) && body.modalities.some(m => m !== 'text'))) return 'asks for audio'
  const items = [body.messages, body.input].flatMap(list => (Array.isArray(list) ? (list as unknown[]) : []))
  for (const item of items) {
    const content = isRecord(item) ? item.content : null
    if (Array.isArray(content) && content.some(p => !isRecord(p) || typeof p.type !== 'string' || !TEXT_PARTS.has(p.type))) {
      return 'sends an image, audio or a file'
    }
  }
  return null
}

/** The most `body`, sent as a request of `kind`, can cost; throws `SpendRefused` when the body does not bound it. */
export function openAiBound(kind: OpenAiRequestKind | null, body: unknown): OpenAiBound {
  if (!kind) throw new SpendRefused('an OpenAI request that is neither a model call nor an embedding: the spend cap cannot price it')
  if (typeof body !== 'string') throw new SpendRefused('an OpenAI request without a JSON body: the spend cap cannot bound its input')
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = null
  }
  if (!isRecord(parsed) || typeof parsed.model !== 'string')
    throw new SpendRefused('an OpenAI request whose body names no model: the spend cap cannot price it')
  const model = parsed.model
  const inputTokens = Buffer.byteLength(body, 'utf8') + INPUT_OVERHEAD_TOKENS
  if (kind === 'embedding') {
    const price = EMBEDDING_PRICES[model]
    if (!price) throw new SpendRefused(`no price recorded for the embedding model ${model} (lib/apiPrices.ts): the spend cap never guesses one`)
    return { kind, model, usd: (inputTokens * price.input) / 1_000_000 }
  }
  const price = modelPrice(model)
  if (!price) throw new SpendRefused(`no price recorded for the model ${model} (lib/apiPrices.ts): the spend cap never guesses one`)
  if (price.maxOutputTokens === null) throw new SpendRefused(`no maximum output recorded for the model ${model} (lib/apiPrices.ts)`)
  const unbounded = unboundedBy(parsed)
  if (unbounded) throw new SpendRefused(`a ${model} request that ${unbounded}: its body does not bound its cost`)
  const limit = positiveInt(parsed.max_completion_tokens) ?? positiveInt(parsed.max_output_tokens) ?? positiveInt(parsed.max_tokens)
  const output = Math.min(limit ?? price.maxOutputTokens, price.maxOutputTokens) * (positiveInt(parsed.n) ?? 1)
  const inputRate = price.input * Math.max(1, price.cacheWrite)
  return { kind, model, usd: (inputTokens * inputRate + output * price.output) / 1_000_000 }
}

/** What an answer to a request cost by its usage, at the standard price; null when the answer gives no usage to read. */
export function openAiAnswerUsd(bound: OpenAiBound, json: unknown): number | null {
  const usage = isRecord(json) ? json.usage : null
  if (!isRecord(usage)) return null
  const input = usage.prompt_tokens ?? usage.input_tokens
  if (typeof input !== 'number') return null
  if (bound.kind === 'embedding') return (input * (EMBEDDING_PRICES[bound.model]?.input ?? Number.NaN)) / 1_000_000
  if (typeof (usage.completion_tokens ?? usage.output_tokens) !== 'number') return null
  // The bound priced the model, so it has a row
  return costOf(bound.model as ModelId, tokensOf(json))
}

/**
 * The answer a refused request gets instead of being sent: a 402 that the OpenAI SDK (`x-should-retry:
 * false`) and LangChain (no retry of a 402) both take as final, so a refusal costs no backoff, and
 * whose error code tells it from OpenAI's own (`spendRefusalOf`).
 */
function refusalAnswer(refusal: SpendRefusal): Response {
  const code = refusal.kind === 'cap-reached' ? SPEND_CAP_REACHED_CODE : SPEND_REFUSED_CODE
  return new Response(JSON.stringify({ error: { message: refusal.message, type: 'spend_cap', code } }), {
    status: 402,
    headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
  })
}

/** The request's worst case, held; or the refusal answer when the guard will not send it. */
async function hold(guard: SpendGuard, init: FetchInit, kind: OpenAiRequestKind | null): Promise<{ bound: OpenAiBound; held: Reservation } | Response> {
  try {
    const bound = openAiBound(kind, init?.body)
    return { bound, held: await guard.reserve(bound.usd, `openai ${bound.model}`) }
  } catch (err) {
    const refusal = spendRefusalOf(err)
    if (!refusal) throw err
    return refusalAnswer(refusal)
  }
}

/** `fetch` with the spend cap in front of it, for one attempt of an OpenAI request. */
export async function cappedFetch(input: FetchInput, init: FetchInit, kind: OpenAiRequestKind | null): Promise<Response> {
  const guard = spendGuard()
  if (!guard) return fetch(input, init)
  const reserved = await hold(guard, init, kind)
  if (reserved instanceof Response) return reserved
  const { bound, held } = reserved
  let res: Response
  try {
    res = await fetch(input, init)
  } catch (err) {
    held.settle(settledUsd(held.usd, null, null))
    throw err
  }
  if (!res.ok) {
    held.settle(settledUsd(held.usd, res.status, null))
    return res
  }
  // Read from a copy, so the SDK still gets the body; one that cannot be read settles at the reservation
  void res
    .clone()
    .json()
    .then(
      (json: unknown) => held.settle(settledUsd(held.usd, res.status, openAiAnswerUsd(bound, json))),
      () => held.settle(held.usd),
    )
  return res
}
