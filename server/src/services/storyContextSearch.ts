/**
 * Pass 2's search in production (`.context/story-context.md`, "Search"): a query asked within
 * `searchReuseDays` is answered from `context_search_cache` at no credit cost; otherwise Tavily
 * answers it (`lib/tavily.ts`, through `withRetry`, its credits counted in the run), and only the
 * results whose publishers do not opt out of AI use (ADR-0056) are kept and cached. The pipeline
 * checks the opt-outs again on every answer, cached ones included.
 */
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { searchTavily } from '../lib/tavily.js'
import type { SourcePolicy } from './researchFilter.js'
import { searchKey, searchResultFrom, tavilyRequestFor, type ContextSearchAnswer, type ContextSearchRequest } from './storyContextSources.js'

const DAY_MS = 24 * 60 * 60 * 1000

const cachedResultsSchema = z.array(z.object({ url: z.string(), title: z.string(), date: z.string().nullable(), text: z.string() }))

const reuseFrom = (now: Date) => new Date(now.getTime() - config.storyContext.searchReuseDays * DAY_MS)

export async function contextSearch(request: ContextSearchRequest, policy: SourcePolicy, now: Date = new Date()): Promise<ContextSearchAnswer> {
  const key = searchKey(request)
  const hit = await prisma.contextSearchCache.findUnique({ where: { key } })
  if (hit && hit.createdAt >= reuseFrom(now)) {
    const results = cachedResultsSchema.safeParse(hit.results)
    if (results.success) return { results: results.data, credits: 0, cached: true }
  }
  const answer = await searchTavily(tavilyRequestFor(request), config.research.tavilyApiKey)
  const results = answer.results.map(searchResultFrom)
  const refused = await Promise.all(results.map(r => policy.optedOut(r.url)))
  const kept = results.filter((_, i) => !refused[i])
  const stored = kept as unknown as Prisma.InputJsonArray
  await prisma.contextSearchCache.upsert({
    where: { key },
    create: { key, query: request.query, results: stored, credits: answer.credits, createdAt: now },
    update: { query: request.query, results: stored, credits: answer.credits, createdAt: now },
  })
  return { results: kept, credits: answer.credits, cached: false }
}

/** Delete the cached answers past their reuse window, at each run's start. */
export async function pruneSearchCache(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.contextSearchCache.deleteMany({ where: { createdAt: { lt: reuseFrom(now) } } })
  return count
}
