/**
 * Find published stories that were probably rated on a paywall teaser (paywalled-stories plan, E4).
 *
 * Read-only: it changes nothing. It lists published stories whose analysis talks about missing
 * content (headline only, paywall, teaser, truncated ...), whose source text carries a publisher's
 * subscribe prompt, or whose source text is shorter than config.paywall.lockedMaxChars, with slug,
 * feed, length and the matching phrase. Unpublishing anything it finds is an editor's decision in
 * the admin, not this script's.
 *
 * Run it where the database is the one you mean to scan. For production, from the Render API
 * service's Shell, which opens in the server folder:
 *
 *   npm run scan:teasers > report.md
 *
 * then keep the report as DOCS/YYYY-MM-DD_teaser-scan.md in the repository checkout. Reused at the
 * four-week review of the access-tier data (BACKLOG.md, "Paywalled stories, phase 2").
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { PrismaClient } from '@prisma/client'
import { config } from '../config.js'

const PAGE_SIZE = 500

/** Remarks an analysis makes when it was written from a teaser rather than the article. */
const TEASER_REMARKS = [
  /\bpaywall(?:ed)?\b/i,
  /\bbehind a (?:pay|subscription) ?wall\b/i,
  /\bsubscriber[- ]only\b/i,
  /\bsubscription required\b/i,
  /\b(?:only|just) the (?:headline|teaser|lead|introduction|first paragraphs?)\b/i,
  /\bheadline only\b/i,
  /\bteaser\b/i,
  /\btruncated\b/i,
  /\b(?:article|text|source) (?:is|was|appears) (?:cut off|incomplete)\b/i,
]

/** A publisher's subscribe prompt left in the extracted source text. */
const SUBSCRIBE_PROMPTS = [
  /weiterlesen mit/i,
  /to enjoy the rest of this story/i,
  /subscribe to (?:continue|read)/i,
  /continue reading with/i,
  /this article is for subscribers/i,
]

function firstMatch(patterns: RegExp[], text: string | null): string | null {
  if (!text) return null
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}

export interface ScannedStory {
  slug: string | null
  sourceTitle: string
  feedTitle: string
  sourceContent: string
  analysis: (string | null)[]
}

export interface TeaserFinding {
  slug: string | null
  sourceTitle: string
  feedTitle: string
  length: number
  reason: string
}

/** Why a published story looks rated on a teaser, or null when nothing suggests it. */
export function teaserReason(story: ScannedStory, lockedMaxChars: number): string | null {
  for (const field of story.analysis) {
    const remark = firstMatch(TEASER_REMARKS, field)
    if (remark) return `analysis: "${remark}"`
  }
  const prompt = firstMatch(SUBSCRIBE_PROMPTS, story.sourceContent)
  if (prompt) return `source text: "${prompt}"`
  const length = story.sourceContent.replace(/\s+/g, ' ').trim().length
  if (length < lockedMaxChars) return `source text under ${lockedMaxChars} characters`
  return null
}

function toMarkdown(findings: TeaserFinding[], scanned: number): string {
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
  const lines = [
    `# Teaser scan, ${new Date().toISOString().slice(0, 10)}`,
    '',
    `${findings.length} of ${scanned} published stories look rated on a teaser.`,
    '',
    '| Slug | Feed | Source title | Length | Reason |',
    '|---|---|---|---|---|',
    ...findings.map(f => `| ${f.slug ?? '-'} | ${escape(f.feedTitle)} | ${escape(f.sourceTitle)} | ${f.length} | ${escape(f.reason)} |`),
  ]
  return lines.join('\n')
}

async function main() {
  const prisma = new PrismaClient()
  const findings: TeaserFinding[] = []
  let scanned = 0
  let cursor: string | undefined
  try {
    for (;;) {
      const page = await prisma.story.findMany({
        where: { status: 'published' },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, slug: true, sourceTitle: true, sourceContent: true,
          summary: true, relevanceReasons: true, relevanceSummary: true, antifactors: true, relevanceCalculation: true,
          feed: { select: { title: true } },
        },
      })
      if (page.length === 0) break
      for (const s of page) {
        const story: ScannedStory = {
          slug: s.slug,
          sourceTitle: s.sourceTitle,
          feedTitle: s.feed.title,
          sourceContent: s.sourceContent,
          analysis: [s.antifactors, s.relevanceCalculation, s.relevanceReasons, s.relevanceSummary, s.summary],
        }
        const reason = teaserReason(story, config.paywall.lockedMaxChars)
        if (reason) findings.push({ slug: s.slug, sourceTitle: s.sourceTitle, feedTitle: s.feed.title, length: s.sourceContent.length, reason })
      }
      scanned += page.length
      cursor = page[page.length - 1].id
    }
    console.log(toMarkdown(findings, scanned))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
