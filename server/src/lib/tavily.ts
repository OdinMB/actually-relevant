/**
 * One Tavily news search over HTTP (story research, `.context/story-research.md`; eval:research
 * caches its answers around it). The key travels in the Authorization header only, never in the
 * body. Credits come from the response's usage field, else from the search depth. Tavily is plain
 * external HTTP, so it goes through `withRetry`. An axios error carries the request headers, so a
 * failure is rethrown as a `TavilyError` holding its status or error code alone.
 */
import axios from 'axios'
import { z } from 'zod'
import { responseStatus, withRetry } from './retry.js'

export const TAVILY_URL = 'https://api.tavily.com/search'
export const TAVILY_DEPTH = 'advanced'
/** Credits one search costs at each depth, when the response reports no usage. */
export const CREDITS_PER_SEARCH = { basic: 1, advanced: 2 } as const
export const TAVILY_MAX_RESULTS = 8
const TIMEOUT_MS = 60_000

export interface TavilySearch {
  query: string
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string
  endDate: string
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

export function tavilyRequestBody(s: TavilySearch) {
  return {
    query: s.query,
    topic: 'news',
    search_depth: TAVILY_DEPTH,
    start_date: s.startDate,
    end_date: s.endDate,
    max_results: TAVILY_MAX_RESULTS,
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

function sanitized(err: unknown): TavilyError {
  const status = responseStatus(err)
  const rawCode = (err as { code?: unknown } | null)?.code
  const code = typeof rawCode === 'string' ? rawCode : undefined
  const what = status !== undefined ? `HTTP ${status}` : (code ?? 'no response')
  return new TavilyError(`Tavily search failed: ${what}`, status, code)
}

async function post(body: ReturnType<typeof tavilyRequestBody>, apiKey: string): Promise<unknown> {
  try {
    const res = await axios.post(TAVILY_URL, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    })
    return res.data
  } catch (err) {
    throw sanitized(err)
  }
}

function parseResponse(data: unknown): TavilyAnswer {
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
    credits: parsed.data.usage?.credits ?? CREDITS_PER_SEARCH[TAVILY_DEPTH],
  }
}

export async function searchTavily(request: TavilySearch, apiKey: string, options: TavilyOptions = {}): Promise<TavilyAnswer> {
  const body = tavilyRequestBody(request)
  return parseResponse(await withRetry(() => post(body, apiKey), options.retry))
}
