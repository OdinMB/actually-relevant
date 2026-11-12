/**
 * Tavily's news search for eval:research: production's HTTP client (`lib/tavily.ts`) behind the
 * eval's own cache and credit ledger.
 *
 * Responses are cached in `.cache/tavily.jsonl`, keyed by the request body, so a resumed run pays
 * nothing twice and later prompts stay stable; the key travels in the Authorization header, so it
 * is in neither the cache key nor the file. A dry run never reaches Tavily.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CREDITS_PER_SEARCH,
  searchTavily,
  TAVILY_DEPTH,
  tavilyRequestBody,
  type TavilyOptions,
  type TavilyResult,
  type TavilySearch,
} from '../../../lib/tavily.js'

export { CREDITS_PER_SEARCH, TAVILY_DEPTH }
export type { TavilySearch }

/**
 * Pay-as-you-go price per credit (design, "Price"); free credits are counted as paid by the budget
 * guard. The eval keeps its own constant beside `config.research.tavilyUsdPerCredit` on purpose.
 */
export const TAVILY_USD_PER_CREDIT = 0.008
export const TAVILY_FREE_CREDITS_PER_MONTH = 1000

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

export interface TavilyClientOptions extends TavilyOptions {
  cacheFile: string
  apiKey: string | undefined
  /** When true, any uncached search throws: a dry run must not reach Tavily. */
  offline: boolean
}

interface CacheLine {
  key: string
  request: ReturnType<typeof tavilyRequestBody>
  response: { results: TavilyResult[]; credits: number }
  at: string
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
      const response = await searchTavily(request, apiKey, options.retry ? { retry: options.retry } : {})
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
