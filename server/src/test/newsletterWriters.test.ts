import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, prismaWrites, rawInsertsOrDeletes, rawUpdates, sourceFiles } from './writeFence.js'

/**
 * Keeps `services/newsletterLifecycle.ts` the only code that moves a newsletter issue (ADR-0048,
 * `.context/newsletter-podcast.md` "Issue lifecycle"). Every non-test source file under `src/`
 * except the module itself, `src/scripts/` and `src/test/` is scanned for:
 * - a Prisma `newsletter.create|update|updateMany|upsert` writing `status`, `publishedAt`,
 *   `content`, `html` or `selectedStoryIds`, and any `newsletter.delete|deleteMany`;
 * - any Prisma `newsletterSend.create|createMany|upsert|delete|deleteMany`, and a
 *   `newsletterSend.update|updateMany` writing `status`, `htmlContent`, `sentAt` or `plunkCampaignId`;
 * - raw SQL updating those columns, or inserting or deleting rows of either table.
 *
 * Allowed elsewhere: `stats` (refreshSendStats), `slug` (ensureNewsletterSlug), `title` and
 * `weekKey` at create (createNewsletter), and `storyIds` (deleteStory's cleanup of a deleted story).
 */

const ALLOWED = new Set([join('services', 'newsletterLifecycle.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test')])

const ISSUE_KEYS = new Set(['status', 'publishedAt', 'content', 'html', 'selectedStoryIds'])
const SEND_KEYS = new Set(['status', 'htmlContent', 'sentAt', 'plunkCampaignId'])

export function newsletterWrites(src: string): string[] {
  return [
    ...prismaWrites(src, 'newsletter', ['create', 'update', 'updateMany', 'updateManyAndReturn', 'upsert'], ISSUE_KEYS),
    ...prismaWrites(src, 'newsletter', ['delete', 'deleteMany'], null),
    ...prismaWrites(src, 'newsletterSend', ['create', 'createMany', 'createManyAndReturn', 'upsert', 'delete', 'deleteMany'], null),
    ...prismaWrites(src, 'newsletterSend', ['update', 'updateMany', 'updateManyAndReturn'], SEND_KEYS),
    ...rawUpdates(src, 'newsletters', /\b(status|published_at|content|html|selected_story_ids)\b/i),
    ...rawUpdates(src, 'newsletter_sends', /\b(status|html_content|sent_at|plunk_campaign_id)\b/i),
    ...rawInsertsOrDeletes(src, 'newsletters'),
    ...rawInsertsOrDeletes(src, 'newsletter_sends'),
  ]
}

describe('newsletter lifecycle writers', () => {
  it('only the lifecycle module moves an issue or writes its sends', () => {
    const offenders = sourceFiles(SRC, ALLOWED, SKIPPED_DIRS).flatMap(path =>
      newsletterWrites(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`),
    )
    expect(offenders).toEqual([])
  })

  it('the scan finds the write shapes it guards against', () => {
    expect(newsletterWrites(`await prisma.newsletter.update({ where: { id }, data: { status: 'published' } })`)).toHaveLength(1)
    expect(newsletterWrites(`await tx.newsletter.update({ where: { id }, data: { title, content: md } })`)).toHaveLength(1)
    expect(newsletterWrites(`await prisma.newsletter.delete({ where: { id } })`)).toHaveLength(1)
    expect(newsletterWrites(`await prisma.newsletterSend.create({ data: { newsletterId, isTest: true } })`)).toHaveLength(1)
    expect(newsletterWrites(`await prisma.newsletterSend.update({ where: { id }, data: { status: 'failed' } })`)).toHaveLength(1)
    expect(newsletterWrites("await prisma.$executeRaw`UPDATE newsletters SET status = 'draft' WHERE id = ${id}`")).toHaveLength(1)
    expect(newsletterWrites('await prisma.$executeRaw`INSERT INTO newsletter_sends (id) VALUES (${id})`')).toHaveLength(1)
    expect(newsletterWrites('await prisma.$executeRaw`UPDATE "newsletter_sends" SET sent_at = now()`')).toHaveLength(1)
  })

  it('the scan ignores stats, slugs, the longlist, creation and filters', () => {
    expect(newsletterWrites(`await prisma.newsletterSend.update({ where: { id }, data: { stats: stats as unknown as Prisma.JsonObject } })`)).toEqual([])
    expect(newsletterWrites(`await prisma.newsletter.update({ where: { id: newsletter.id }, data: { slug: candidate } })`)).toEqual([])
    expect(newsletterWrites(`prisma.newsletter.update({ where: { id: nl.id }, data: { storyIds: nl.storyIds.filter(sid => sid !== id) } })`)).toEqual([])
    expect(newsletterWrites(`await prisma.newsletter.create({ data: { title: data.title, weekKey: data.weekKey } })`)).toEqual([])
    expect(newsletterWrites(`await prisma.newsletter.updateMany({ where: { status: 'draft' }, data: { title } })`)).toEqual([])
    expect(newsletterWrites(`await prisma.newsletter.findMany({ where: { status: 'published' } })`)).toEqual([])
  })
})
