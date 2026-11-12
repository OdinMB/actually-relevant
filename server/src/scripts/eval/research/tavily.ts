/**
 * Tavily's news search for eval:research: the eval's one external HTTP client besides OpenAI.
 *
 * Responses are cached in `.cache/tavily.jsonl`, keyed by the request body, so a resumed run pays
 * nothing twice and later prompts stay stable; the key travels in the Authorization header, so it
 * is in neither the cache key nor the file. Credits come from the response's usage field, else
 * from the search depth. Tavily is plain external HTTP, so it goes through `withRetry` as the
 * app's other external calls do (`imports.test.ts` allows it in this file only). An axios error
 * carries the request headers, so a failure is rethrown with its status or error code alone.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import axios from 'axios'
import { z } from 'zod'
import { responseStatus, withRetry } from '../../../lib/retry.js'

export const TAVILY_URL = 'https://api.tavily.com/search'
/** Pay-as-you-go price per credit (design, "Price"); free credits are counted as paid by the budget guard. */
export const TAVILY_USD_PER_CREDIT = 0.008
export const TAVILY_FREE_CREDITS_PER_MONTH = 1000
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

export interface TavilyResponse {
  results: TavilyResult[]
  /** Credits this request cost when it was made (also for a cached answer). */
  credits: number
  cached: boolean
}

export interface TavilyClient {
  search(request: TavilySearch): Promise<TavilyResponse>
  /** Every credit recorded in the cache file: this folder's Tavily ledger. */
  creditsRecorded(): number
  liveRequests(): number
}

export interface TavilyClientOptions {
  cacheFile: string
  apiKey: string | undefined
  /** When true, any uncached search throws: a dry run must not reach Tavily. */
  offline: boolean
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

interface CacheLine {
  key: string
  request: ReturnType<typeof tavilyRequestBody>
  response: { results: TavilyResult[]; credits: number }
  at: string
}

/** A failure that holds only what may be printed: the HTTP status or the network error code. */
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

function requestKey(body: ReturnType<typeof tavilyRequestBody>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex')
}

function readCache(file: string): Map<string, CacheLine> {
  const lines = new Map<string, CacheLine>()
  if (!existsSync(file)) return lines
  const all = readFileSync(file, 'utf8').split('\n')
  all.forEach((line, i) => {
    if (!line.trim()) return
    try {
      const entry = JSON.parse(line) as CacheLine
      lines.set(entry.key, entry)
    } catch (err) {
      // A last line cut off by an interrupted run is skipped; a broken line elsewhere is a real problem.
      if (all.slice(i + 1).some(l => l.trim())) throw err
      console.warn(`tavily cache: skipped an unfinished last line in ${file}`)
    }
  })
  return lines
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

function parseResponse(data: unknown): { results: TavilyResult[]; credits: number } {
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

export function createTavilyClient(options: TavilyClientOptions): TavilyClient {
  mkdirSync(dirname(options.cacheFile), { recursive: true })
  const cache = readCache(options.cacheFile)
  let credits = [...cache.values()].reduce((sum, line) => sum + line.response.credits, 0)
  let live = 0

  return {
    async search(request) {
      const body = tavilyRequestBody(request)
      const key = requestKey(body)
      const hit = cache.get(key)
      if (hit) return { ...hit.response, cached: true }
      if (options.offline) throw new Error('offline run tried to call Tavily')
      const apiKey = options.apiKey
      if (!apiKey) throw new Error('TAVILY_API_KEY is missing')
      live++
      const response = parseResponse(await withRetry(() => post(body, apiKey), options.retry))
      const line: CacheLine = { key, request: body, response, at: new Date().toISOString() }
      appendFileSync(options.cacheFile, JSON.stringify(line) + '\n')
      cache.set(key, line)
      credits += response.credits
      return { ...response, cached: false }
    },
    creditsRecorded: () => credits,
    liveRequests: () => live,
  }
}
