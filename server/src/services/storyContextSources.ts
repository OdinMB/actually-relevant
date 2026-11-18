/**
 * Pass 2's sources, the pure part (`.context/story-context.md`, "Search"): the Tavily request for a
 * search, the text chosen from a result (as research chooses it), the cache key, the source filter
 * (research's blocklist, the story's own sources, at most 2 a query and 5 in all) and the short
 * passage kept around a supporting sentence. The I/O, cache and opt-out check, is in
 * `storyContextSearch.ts`.
 */
import { createHash } from 'node:crypto'
import { config } from '../config.js'
import type { TavilyResult, TavilySearch } from '../lib/tavily.js'
import { BLOCKED_DOMAINS, domainOf, normalizedUrl, selectedText } from './researchFilter.js'

export interface ContextSearchRequest {
  query: string
  /** Only data from the 30 days before the story can answer it. */
  recent: boolean
  /** The story's publication day, `YYYY-MM-DD`: the search's end date. */
  endDate: string
}

export interface ContextSearchResult {
  url: string
  title: string
  /** As Tavily gives it; null when unknown. */
  date: string | null
  /** What the extraction reads: the passages, or the raw text when they are short, cut to size. */
  text: string
}

export interface ContextSearchAnswer {
  results: ContextSearchResult[]
  credits: number
  /** Answered from `context_search_cache`, at no credit cost. */
  cached: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The Tavily request for a context search: basic depth, the general topic, raw text, ending on the story's day and starting 30 days before only for recent data. */
export function tavilyRequestFor(request: ContextSearchRequest): TavilySearch {
  const c = config.storyContext
  const start = new Date(Date.parse(`${request.endDate}T00:00:00Z`) - c.recentDays * DAY_MS).toISOString().slice(0, 10)
  return {
    query: request.query,
    endDate: request.endDate,
    ...(request.recent ? { startDate: start } : {}),
    depth: c.searchDepth,
    topic: 'general',
    maxResults: c.resultsPerSearch,
  }
}

/** A Tavily result with the text research would choose from it. */
export function searchResultFrom(r: TavilyResult): ContextSearchResult {
  const { text } = selectedText({
    origin: 'search',
    url: r.url,
    title: r.title,
    outlet: '',
    date: r.publishedDate,
    passages: r.content,
    rawContent: r.rawContent,
    favicon: null,
  })
  return { url: r.url, title: r.title, date: r.publishedDate, text }
}

/** A query as the cache key and a rerun's "already made" check read it: NFKC, lower case, single spaces. */
export const normalizedQuery = (query: string) => query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** The cache key: the normalized query, the depth, the topic and the recent flag. The end date is left out, so a query asked for stories a few days apart is answered once. */
export function searchKey(request: Pick<ContextSearchRequest, 'query' | 'recent'>): string {
  const t = tavilyRequestFor({ ...request, endDate: '2000-01-01' })
  return createHash('sha256')
    .update(JSON.stringify([normalizedQuery(request.query), t.depth, t.topic, request.recent]))
    .digest('hex')
}

/** `read`: an earlier run of the story picked the URL to read (`.context/story-context.md`, "On demand"). */
export type SourceDropReason = 'opt-out' | 'blocklist' | 'known' | 'read' | 'empty' | 'per-query' | 'cap'

export interface SourceDrop {
  url: string
  search: number
  reason: SourceDropReason
}

export interface PickedSource {
  /** The index of the search that found it. */
  search: number
  result: ContextSearchResult
}

const isBlocked = (domain: string) => BLOCKED_DOMAINS.some(b => domain === b || domain.endsWith(`.${b}`))

/**
 * The sources pass 2 extracts from, in search order: never a blocklisted domain, a URL or domain
 * already among the story's sources (`known`), a URL an earlier run of the story read (`read`; its
 * domain stays open), a URL another search already gave, or a result without text; at most
 * `perQuerySources` a search and `maxNewSources` in all.
 */
export function pickNewSources(
  answers: { results: ContextSearchResult[] }[],
  known: { urls: string[]; domains: string[]; read?: string[] },
): { picked: PickedSource[]; drops: SourceDrop[] } {
  const { perQuerySources, maxNewSources } = config.storyContext
  const urls = new Set(known.urls.map(normalizedUrl))
  const domains = new Set(known.domains)
  const read = new Set((known.read ?? []).map(normalizedUrl))
  const picked: PickedSource[] = []
  const drops: SourceDrop[] = []
  answers.forEach((answer, search) => {
    let fromThis = 0
    for (const result of answer.results) {
      const domain = domainOf(result.url)
      const drop = (reason: SourceDropReason) => drops.push({ url: result.url, search, reason })
      if (isBlocked(domain)) drop('blocklist')
      else if (urls.has(normalizedUrl(result.url)) || domains.has(domain)) drop('known')
      else if (read.has(normalizedUrl(result.url))) drop('read')
      else if (result.text.trim() === '') drop('empty')
      else if (fromThis >= perQuerySources) drop('per-query')
      else if (picked.length >= maxNewSources) drop('cap')
      else {
        picked.push({ search, result })
        urls.add(normalizedUrl(result.url))
        fromThis++
      }
    }
  })
  return { picked, drops }
}

const SENTENCE = /[^.!?]+(?:[.!?]+["'”’)\]]*|$)\s*/g
const squashed = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The supporting sentence with one sentence either side, as it stands in the fetched text, at most
 * `max` characters; the sentence alone (cut to size) when it is not found or the three are longer.
 */
export function passageAround(text: string, sentence: string, max = 600): string {
  const parts = text.match(SENTENCE)?.map(p => p.trim()) ?? []
  const needle = squashed(sentence).slice(0, 40)
  const i = needle === '' ? -1 : parts.findIndex(p => squashed(p).includes(needle))
  if (i >= 0) {
    const passage = parts.slice(Math.max(0, i - 1), i + 2).join(' ')
    if (passage.length <= max) return passage
  }
  return sentence.slice(0, max)
}
