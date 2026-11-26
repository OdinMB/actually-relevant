/**
 * One Tavily search over HTTP: story research's news search (`.context/story-research.md`; eval:research
 * caches its answers around it), and story context's general search at basic depth with an open or
 * 30-day window (`.context/story-context.md`), through the optional `depth`, `topic`, `maxResults`
 * and `startDate`; without them the request is research's, byte for byte. The key travels in the
 * Authorization header only, never in the body. Credits come from the response's usage field, else
 * from the search depth. Tavily is plain external HTTP, so it goes through `withRetry`. An axios
 * error carries the request headers, so a failure is rethrown as a `TavilyError` holding its status
 * or error code alone. Under a task spend cap (an eval command, `lib/spendCap.ts`) each attempt is
 * reserved at its depth's credits before it is sent and settled once it ends; with none, as in
 * production, nothing changes.
 */
import axios from 'axios'
import { z } from 'zod'
import { TAVILY_USD_PER_CREDIT } from './apiPrices.js'
import { responseStatus, withRetry } from './retry.js'
import { recordOtherCost } from './runUsage.js'
import { settledUsd, spendGuard, SpendRefused, type Reservation } from './spendCap.js'
import { config } from '../config.js'

export const TAVILY_URL = 'https://api.tavily.com/search'
export const TAVILY_DEPTH = 'advanced'
/** Credits one search costs at each depth, when the response reports no usage. */
export const CREDITS_PER_SEARCH = { basic: 1, advanced: 2 } as const
export const TAVILY_MAX_RESULTS = 8
const TIMEOUT_MS = 60_000

export type TavilyDepth = keyof typeof CREDITS_PER_SEARCH

export interface TavilySearch {
  query: string
  /** `YYYY-MM-DD`, inclusive; unset leaves the window open before `endDate`. */
  startDate?: string
  endDate: string
  /** Research's `advanced` when unset. */
  depth?: TavilyDepth
  /** Research's `news` when unset. */
  topic?: 'news' | 'general'
  /** Research's `TAVILY_MAX_RESULTS` when unset. */
  maxResults?: number
}

export interface TavilyResult {
  url: string
  title: string
  /** The content passages Tavily picked for the query. */
  content: string
  /** The page's text, when Tavily could fetch it. */
  rawContent: string | null
  publishedDate: string | null
  favicon: string | null
}

export interface TavilyAnswer {
  results: TavilyResult[]
  /** Credits the request cost. */
  credits: number
}

export interface TavilyOptions {
  /** For tests; production uses withRetry's defaults. */
  retry?: { retries?: number; baseDelayMs?: number }
}

/** The request's JSON body; key order and values are research's when no option is set (tavily.test.ts holds it byte for byte). */
export function tavilyRequestBody(s: TavilySearch) {
  return {
    query: s.query,
    topic: s.topic ?? 'news',
    search_depth: s.depth ?? TAVILY_DEPTH,
    ...(s.startDate !== undefined ? { start_date: s.startDate } : {}),
    end_date: s.endDate,
    max_results: s.maxResults ?? TAVILY_MAX_RESULTS,
    include_favicon: true,
    include_raw_content: 'text',
    include_answer: false,
    include_images: false,
    include_usage: true,
  }
}

const responseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      raw_content: z.string().nullish(),
      published_date: z.string().nullish(),
      favicon: z.string().nullish(),
    }),
  ),
  usage: z.object({ credits: z.number() }).nullish(),
})

/** A failure that holds only what may be printed or stored: the HTTP status or the network error code. */
export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'TavilyError'
  }
}

/**
 * The most a search can cost, in credits: its depth's (Tavily's pricing: basic 1, advanced 2), read
 * from the request alone, for the task spend cap (`lib/spendCap.ts`). A depth with no price is refused.
 */
export function searchCreditsBound(body: ReturnType<typeof tavilyRequestBody>): number {
  const credits = (CREDITS_PER_SEARCH as Record<string, number | undefined>)[body.search_depth]
  if (credits === undefined)
    throw new SpendRefused(`a Tavily search at depth "${body.search_depth}", which has no price recorded: the spend cap cannot bound it`)
  return credits
}

/** The search's worst case held under the installed spend cap; null without one, as in production. */
function reserveSearch(body: ReturnType<typeof tavilyRequestBody>): Promise<Reservation> | null {
  const guard = spendGuard()
  if (!guard) return null
  return guard.reserve(searchCreditsBound(body) * TAVILY_USD_PER_CREDIT, `tavily ${body.search_depth} search`)
}

/** What an answer says it cost, at the cap's credit price; null when it reports no usage. */
function reportedUsd(data: unknown): number | null {
  const credits = (data as { usage?: { credits?: unknown } } | null)?.usage?.credits
  return typeof credits === 'number' && Number.isFinite(credits) ? credits * TAVILY_USD_PER_CREDIT : null
}

function sanitized(err: unknown): TavilyError {
  const status = responseStatus(err)
  const rawCode = (err as { code?: unknown } | null)?.code
  const code = typeof rawCode === 'string' ? rawCode : undefined
  const what = status !== undefined ? `HTTP ${status}` : (code ?? 'no response')
  return new TavilyError(`Tavily search failed: ${what}`, status, code)
}

async function post(body: ReturnType<typeof tavilyRequestBody>, apiKey: string): Promise<unknown> {
  // Reserved before the try: a refusal is thrown as it is, neither sanitized nor retried
  const held = await reserveSearch(body)
  try {
    const res = await axios.post(TAVILY_URL, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    })
    held?.settle(settledUsd(held.usd, res.status, reportedUsd(res.data)))
    return res.data
  } catch (err) {
    held?.settle(settledUsd(held.usd, responseStatus(err) ?? null, null))
    throw sanitized(err)
  }
}

function parseResponse(data: unknown, depth: TavilyDepth): TavilyAnswer {
  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) throw new TavilyError('Tavily search returned a response of an unexpected shape')
  return {
    results: parsed.data.results.map(r => ({
      url: r.url,
      title: r.title ?? '',
      content: r.content ?? '',
      rawContent: r.raw_content ?? null,
      publishedDate: r.published_date ?? null,
      favicon: r.favicon ?? null,
    })),
    credits: parsed.data.usage?.credits ?? CREDITS_PER_SEARCH[depth],
  }
}

export async function searchTavily(request: TavilySearch, apiKey: string, options: TavilyOptions = {}): Promise<TavilyAnswer> {
  const body = tavilyRequestBody(request)
  const answer = parseResponse(await withRetry(() => post(body, apiKey), options.retry), request.depth ?? TAVILY_DEPTH)
  // Counts toward the job run's cost on the Jobs page; nothing outside a run (lib/runUsage.ts)
  recordOtherCost(answer.credits * config.research.tavilyUsdPerCredit, answer.credits)
  return answer
}
