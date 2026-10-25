/**
 * The weekly publish_newsletter run against PostgreSQL, with an in-memory Plunk: what it sends,
 * what it publishes, and the notice every run leaves in admin_notices.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createNewsletter, createSend, describeDb, useTestDatabase } from '../test/db/harness.js'
import { fakePlunk } from '../test/fakePlunk.js'

vi.mock('../services/llm.js', () => ({ getLLMByTier: vi.fn(), rateLimitDelay: () => Promise.resolve() }))
vi.mock('../services/plunk.js', () => import('../test/fakePlunk.js'))

const { runPublishNewsletter, newsletterSendProblem } = await import('./publishNewsletter.js')
const { getWeekKey } = await import('./generateNewsletter.js')

// Saturday 2026-02-21 04:30 UTC, ISO week 8
const SATURDAY = new Date('2026-02-21T04:30:00Z')
const WEEK = getWeekKey(SATURDAY)
const HTML = '<p>Week 8</p>'

/** This week's automatic issue, built. */
const weeklyIssue = (data: Parameters<typeof createNewsletter>[0] = {}) => createNewsletter({ title: 'Week 8, 2026', weekKey: WEEK, html: HTML, ...data })
const notices = () => prisma.adminNotice.findMany({ orderBy: { firstOccurredAt: 'asc' } })

describeDb('runPublishNewsletter', () => {
  useTestDatabase()
  beforeEach(() => fakePlunk.reset())

  it("sends this week's tested draft to all subscribers, publishes it and says so", async () => {
    const issue = await weeklyIssue()
    await createSend({ newsletterId: issue.id, isTest: true, status: 'sent' })

    await runPublishNewsletter(SATURDAY)

    expect(fakePlunk.liveSends()).toHaveLength(1)
    expect(await prisma.newsletter.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({ status: 'published', slug: 'week-8-2026' })
    expect(await notices()).toEqual([expect.objectContaining({ source: 'newsletter', severity: 'info', title: 'Newsletter sent' })])
  })

  it('sends nothing without a test email of the current HTML, and warns once a week', async () => {
    const issue = await weeklyIssue()
    await createSend({ newsletterId: issue.id, isTest: true, status: 'sent', htmlContent: '<p>An older build</p>' })

    await runPublishNewsletter(SATURDAY)
    await prisma.newsletterSend.deleteMany({ where: { newsletterId: issue.id } }) // no test at all
    await runPublishNewsletter(SATURDAY)

    expect(fakePlunk.liveSends()).toEqual([])
    expect(await notices()).toEqual([
      expect.objectContaining({
        severity: 'warning',
        title: 'Newsletter not sent',
        dedupeKey: `newsletter-not-sent:${WEEK}`,
        count: 2,
        message: expect.stringContaining('test email of its current HTML'),
      }),
    ])
  })

  it('warns when there is no automatic issue this week, or it is still being built', async () => {
    await runPublishNewsletter(SATURDAY)
    expect((await notices())[0]!.message).toContain('no automatic issue')

    await weeklyIssue({ html: '' })
    await runPublishNewsletter(SATURDAY)
    expect((await notices())[0]!.message).toContain('still being built')
    expect(fakePlunk.campaigns).toEqual([])
  })

  it('records an info notice, and sends nothing, when the issue was already sent or published', async () => {
    const published = await weeklyIssue({ status: 'published' })
    await createSend({ newsletterId: published.id, isTest: true, status: 'sent' })
    await runPublishNewsletter(SATURDAY)
    await prisma.newsletter.delete({ where: { id: published.id } })

    const sent = await weeklyIssue()
    await createSend({ newsletterId: sent.id, isTest: false, status: 'sending', sentAt: new Date() })
    await runPublishNewsletter(SATURDAY)

    expect(fakePlunk.campaigns).toEqual([])
    expect(await notices()).toEqual([
      expect.objectContaining({ severity: 'info', title: 'Newsletter already sent', dedupeKey: `newsletter-already-sent:${WEEK}`, count: 2 }),
    ])
  })

  it('fails the run on a Plunk failure, leaving a draft with a failed send that a later run retries', async () => {
    const issue = await weeklyIssue()
    await createSend({ newsletterId: issue.id, isTest: true, status: 'sent' })
    fakePlunk.failNextSend('client_error')

    await expect(runPublishNewsletter(SATURDAY)).rejects.toThrow('422')

    expect((await prisma.newsletter.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('draft')
    expect(await prisma.newsletterSend.findMany({ where: { newsletterId: issue.id, isTest: false } })).toEqual([expect.objectContaining({ status: 'failed' })])
    expect(await notices()).toEqual([])

    await runPublishNewsletter(SATURDAY)
    expect(fakePlunk.liveSends()).toHaveLength(1)
  })

  it('sends nothing more after an unconfirmed send, and asks for a check in Plunk', async () => {
    const issue = await weeklyIssue()
    await createSend({ newsletterId: issue.id, isTest: true, status: 'sent' })
    fakePlunk.failNextSend('ambiguous')

    await expect(runPublishNewsletter(SATURDAY)).rejects.toThrow('timeout')
    await runPublishNewsletter(SATURDAY)

    expect(fakePlunk.liveSends()).toHaveLength(1)
    expect(await notices()).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('unconfirmed') })])
  })
})

describeDb('newsletterSendProblem', () => {
  const original = config.plunk.secretKey
  afterEach(() => {
    config.plunk.secretKey = original
  })

  it('names PLUNK_SECRET_KEY when it is missing, and is null once it is set', () => {
    config.plunk.secretKey = ''
    expect(newsletterSendProblem()).toContain('PLUNK_SECRET_KEY')
    config.plunk.secretKey = 'sk'
    expect(newsletterSendProblem()).toBeNull()
  })
})
