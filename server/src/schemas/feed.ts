import { z } from 'zod'

const feedRegionValues = [
  'north_america',
  'western_europe',
  'eastern_europe',
  'middle_east_north_africa',
  'sub_saharan_africa',
  'south_southeast_asia',
  'pacific',
  'latin_america',
  'global',
] as const

const feedRegionSchema = z.enum(feedRegionValues)

function compilesAsRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/**
 * A group containing + or * that is itself repeated, e.g. (\w+\s?)+ or (.*)*: the shape that
 * backtracks catastrophically. A heuristic, not a proof of safety; the crawl also caps the title.
 */
const NESTED_REPETITION = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*[+*{]/

/** A regex tested on an article's title; a match marks the article paywall-locked (ADR-0032). */
const paywallTitleMarkerSchema = z.string()
  .min(1)
  .max(200, 'Title marker must be at most 200 characters')
  .refine(compilesAsRegex, 'Title marker must be a valid regular expression')
  .refine(pattern => !NESTED_REPETITION.test(pattern), 'Title marker must not contain nested repetition')

export const createFeedSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  rssUrl: z.string().url('Must be a valid URL'),
  url: z.string().url('Must be a valid URL').nullable().optional(),
  displayTitle: z.string().optional(),
  language: z.string().optional().default('en'),
  region: feedRegionSchema.nullable().optional(),
  issueId: z.string().uuid('Must be a valid issue ID'),
  crawlIntervalHours: z.number().int().positive().optional().default(24),
  htmlSelector: z.string().optional(),
  paywallDetection: z.boolean().optional(),
  paywallTitleMarker: paywallTitleMarkerSchema.nullable().optional(),
})

export const updateFeedSchema = z.object({
  title: z.string().min(1).optional(),
  rssUrl: z.string().url('Must be a valid URL').optional(),
  url: z.string().url('Must be a valid URL').nullable().optional(),
  displayTitle: z.string().nullable().optional(),
  language: z.string().optional(),
  region: feedRegionSchema.nullable().optional(),
  issueId: z.string().uuid('Must be a valid issue ID').optional(),
  crawlIntervalHours: z.number().int().positive().optional(),
  htmlSelector: z.string().nullable().optional(),
  paywallDetection: z.boolean().optional(),
  paywallTitleMarker: paywallTitleMarkerSchema.nullable().optional(),
  active: z.boolean().optional(),
})
