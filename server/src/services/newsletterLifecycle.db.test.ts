/**
 * Newsletter issue moves against PostgreSQL, with an in-memory Plunk (`test/fakePlunk.ts`) and the
 * model mocked. A mocked model call that sends the issue mid-call is how the race between a build
 * move and a live send is reproduced.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createFeed, createIssue, createNewsletter, createSend, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { fakePlunk } from '../test/fakePlunk.js'

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('./llm.js', () => ({
  getLLMByTier: () => ({ withStructuredOutput: () => ({ invoke: mockInvoke }) }),
  rateLimitDelay: () => Promise.resolve(),
}))
vi.mock('./plunk.js', () => import('../test/fakePlunk.js'))

const lifecycle = await import('./newsletterLifecycle.js')
const { sendLive, sendTest, markSendFailed, editNewsletter, publishNewsletter, unpublishNewsletter, deleteNewsletter } = lifecycle

const HTML = '<p>The issue</p>'
const CONTENT = '## A story\nPublisher · [original article](https://news.example/a)\n\nWhy it matters.'

/** An issue with HTML, as the build moves leave it. */
const builtIssue = (data: Parameters<typeof createNewsletter>[0] = {}) => createNewsletter({ title: 'Week 8, 2026', html: HTML, content: CONTENT, ...data })

/** A built issue whose test email of its current HTML went out. */
async function testedIssue(data: Parameters<typeof createNewsletter>[0] = {}) {
  const issue = await builtIssue(data)
  await createSend({ newsletterId: issue.id, isTest: true, status: 'sent' })
  return issue
}

const issueOf = (id: string) => prisma.newsletter.findUniqueOrThrow({ where: { id } })
const liveRowsOf = (id: string) => prisma.newsletterSend.findMany({ where: { newsletterId: id, isTest: false }, orderBy: { createdAt: 'asc' } })

describeDb('newsletter lifecycle', () => {
  useTestDatabase()

  const originalSegment = config.plunk.testSegmentId
  beforeEach(() => {
    fakePlunk.reset()
    mockInvoke.mockReset()
    config.plunk.testSegmentId = 'seg-test'
  })
  afterEach(() => {
    config.plunk.testSegmentId = originalSegment
  })

  // ──── Live sends ────

  it('refuses a second live send, and Plunk sends once', async () => {
    const issue = await testedIssue()

    await sendLive(issue.id)
    await expect(sendLive(issue.id)).rejects.toMatchObject({ status: 409, code: 'already_sent' })

    expect(fakePlunk.liveSends()).toHaveLength(1)
    expect(await liveRowsOf(issue.id)).toHaveLength(1)
  })

  it('sends one email when live sends run at once, and refuses the others', async () => {
    // With a slug already, nothing before the claim serializes the calls
    const issue = await testedIssue({ slug: 'week-8-2026' })

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => sendLive(issue.id)))

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const refusals = results.flatMap(r => (r.status === 'rejected' ? [r.reason as { code?: string }] : []))
    expect(refusals.map(r => r.code)).toEqual(Array(5).fill('already_sent'))
    expect(fakePlunk.liveSends()).toHaveLength(1)
    expect(await liveRowsOf(issue.id)).toHaveLength(1)
  })

  it('waits for a move holding the issue, then sees its claim and refuses', async () => {
    const issue = await testedIssue({ slug: 'week-8-2026' })
    let release!: () => void
    const released = new Promise<void>(resolve => (release = resolve))
    let signalLocked!: () => void
    const locked = new Promise<void>(resolve => (signalLocked = resolve))
    // Another caller's claim, still in its transaction
    const other = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM newsletters WHERE id = ${issue.id} FOR UPDATE`
        await tx.newsletterSend.create({ data: { newsletterId: issue.id, isTest: false, status: 'draft', htmlContent: HTML } })
        signalLocked()
        await released
      },
      { timeout: 10_000 },
    )
    await locked

    const outcome = sendLive(issue.id).then(
      () => null,
      (err: unknown) => err,
    )
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(fakePlunk.liveSends()).toEqual([])
    release()
    await other

    expect(await outcome).toMatchObject({ code: 'already_sent' })
    expect(fakePlunk.liveSends()).toEqual([])
  })

  it('never repeats a send whose outcome is unknown, until an editor marks it not sent', async () => {
    const issue = await testedIssue()
    fakePlunk.failNextSend('ambiguous')

    await expect(sendLive(issue.id)).rejects.toThrow('timeout')

    const [unconfirmed] = await liveRowsOf(issue.id)
    expect(unconfirmed).toMatchObject({ status: 'draft', plunkCampaignId: 'campaign-1', errorMessage: expect.stringContaining('Plunk may have accepted') })
    expect((await issueOf(issue.id)).status).toBe('draft')
    await expect(sendLive(issue.id)).rejects.toMatchObject({ code: 'already_sent' })
    expect(fakePlunk.liveSends()).toHaveLength(1)
    // Unconfirmed freezes the issue, unpublished as it is
    await expect(editNewsletter(issue.id, { title: 'Renamed' })).rejects.toMatchObject({ code: 'frozen' })

    await markSendFailed(issue.id, unconfirmed!.id)
    await sendLive(issue.id)

    expect(fakePlunk.liveSends()).toHaveLength(2)
    expect((await liveRowsOf(issue.id)).map(r => r.status)).toEqual(['failed', 'sending'])
  })

  it('marks a send failed when it provably went nowhere, and a retry sends', async () => {
    for (const failure of ['not_connected', 'client_error'] as const) {
      const issue = await testedIssue()
      fakePlunk.failNextSend(failure)

      await expect(sendLive(issue.id)).rejects.toThrow()
      expect((await liveRowsOf(issue.id)).map(r => r.status)).toEqual(['failed'])

      await sendLive(issue.id)
      expect((await liveRowsOf(issue.id)).map(r => r.status)).toEqual(['failed', 'sending'])
    }
    expect(fakePlunk.liveSends()).toHaveLength(2)
  })

  it('marks a send failed when the campaign cannot be created', async () => {
    const issue = await testedIssue()
    fakePlunk.failNextCreate()

    await expect(sendLive(issue.id)).rejects.toThrow('503')

    expect(await liveRowsOf(issue.id)).toEqual([expect.objectContaining({ status: 'failed', plunkCampaignId: null })])
    await sendLive(issue.id)
    expect(fakePlunk.liveSends()).toHaveLength(1)
  })

  it('needs a test email of the current HTML: none, or a stale one, does not unlock the live send', async () => {
    const issue = await builtIssue()
    await expect(sendLive(issue.id)).rejects.toMatchObject({ code: 'no_current_test' })

    await sendTest(issue.id)
    await editNewsletter(issue.id, { html: '<p>Changed after the test</p>' })
    await expect(sendLive(issue.id)).rejects.toMatchObject({ code: 'no_current_test' })
    expect(await liveRowsOf(issue.id)).toEqual([])
    expect(fakePlunk.liveSends()).toEqual([])

    await sendTest(issue.id)
    const send = await sendLive(issue.id)
    expect(send.htmlContent).toBe('<p>Changed after the test</p>')
  })

  it('publishes the issue it sends: status, slug, and the send time as its date', async () => {
    const issue = await testedIssue()

    const send = await sendLive(issue.id)

    const after = await issueOf(issue.id)
    expect(send).toMatchObject({ status: 'sending', plunkCampaignId: 'campaign-1' })
    expect(after).toMatchObject({ status: 'published', slug: 'week-8-2026', publishedAt: send.sentAt })
    expect(fakePlunk.campaigns[0]).toMatchObject({ audienceType: 'ALL', subject: 'Week 8, 2026', body: HTML })
  })

  it('records a scheduled send as scheduled, and publishes at once', async () => {
    const issue = await testedIssue()

    const send = await sendLive(issue.id, '2026-11-01T07:00:00.000Z')

    expect(send).toMatchObject({ status: 'scheduled', sentAt: null })
    expect(fakePlunk.accepted[0]!.scheduledFor).toBe('2026-11-01T07:00:00.000Z')
    expect((await issueOf(issue.id)).status).toBe('published')
  })

  it('answers 400 for an issue without HTML and sends nothing', async () => {
    const issue = await createNewsletter({ content: CONTENT })
    await expect(sendLive(issue.id)).rejects.toMatchObject({ status: 400 })
    await expect(sendTest(issue.id)).rejects.toMatchObject({ status: 400 })
    expect(fakePlunk.campaigns).toEqual([])
  })

  // ──── Frozen after sending ────

  it('refuses every build move and edit of a sent issue until it is unpublished; republishing keeps its date and slug', async () => {
    const topic = await createIssue()
    const feed = await createFeed(topic.id)
    const story = await createStory({ feedId: feed.id, status: 'published', title: 'A story' })
    const issue = await testedIssue({ storyIds: [story.id], selectedStoryIds: [story.id] })
    await sendLive(issue.id)
    const sent = await issueOf(issue.id)

    const moves: [string, () => Promise<unknown>][] = [
      ['assign', () => lifecycle.assignStories(issue.id)],
      ['select', () => lifecycle.selectStories(issue.id)],
      ['generate', () => lifecycle.generateContent(issue.id)],
      ['html', () => lifecycle.generateHtml(issue.id)],
      ['edit title', () => editNewsletter(issue.id, { title: 'Renamed' })],
      ['edit content', () => editNewsletter(issue.id, { content: 'Rewritten' })],
    ]
    for (const [name, move] of moves) await expect(move(), name).rejects.toMatchObject({ status: 409, code: 'frozen' })
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(await issueOf(issue.id)).toEqual(sent)
    // An edit with nothing in it (a PUT carrying only a status) is not refused
    expect(await editNewsletter(issue.id, {})).toEqual(sent)

    await unpublishNewsletter(issue.id)
    await editNewsletter(issue.id, { content: `${CONTENT}\n\nA typo fixed.` })
    expect(await lifecycle.generateHtml(issue.id)).toContain('A typo fixed.')
    await expect(sendLive(issue.id)).rejects.toMatchObject({ code: 'already_sent' })

    const republished = await publishNewsletter(issue.id)
    expect(republished).toMatchObject({ status: 'published', slug: sent.slug, publishedAt: sent.publishedAt })
    expect(fakePlunk.liveSends()).toHaveLength(1)
  })

  it("keeps the content of an issue sent while generate's model call ran", async () => {
    const topic = await createIssue()
    const feed = await createFeed(topic.id)
    const story = await createStory({ feedId: feed.id, status: 'published', title: 'A story' })
    const issue = await testedIssue({ selectedStoryIds: [story.id] })
    mockInvoke.mockImplementation(async () => {
      await sendLive(issue.id)
      return { intro: 'A fresh intro.' }
    })

    await expect(lifecycle.generateContent(issue.id)).rejects.toMatchObject({ code: 'frozen' })

    expect((await issueOf(issue.id)).content).toBe(CONTENT)
    expect(fakePlunk.liveSends()).toHaveLength(1)
  })

  it('leaves a sent issue that is not published open for editing', async () => {
    const issue = await builtIssue()
    await createSend({ newsletterId: issue.id, isTest: false, status: 'sending', sentAt: new Date() })

    expect((await editNewsletter(issue.id, { title: 'Renamed' })).title).toBe('Renamed')
  })

  // ──── Generation writes ────

  it('writes the longlist, shortlist, content with story markers, and HTML', async () => {
    const topic = await createIssue()
    const feed = await createFeed(topic.id)
    const story = await createStory({ feedId: feed.id, status: 'published', title: 'Cities cut smog' })
    const issue = await createNewsletter({ title: 'Week 9, 2026' })

    expect((await lifecycle.assignStories(issue.id)).storyIds).toEqual([story.id])
    mockInvoke.mockResolvedValueOnce({ selectedIds: [story.id, 'not-on-the-longlist'] })
    expect((await lifecycle.selectStories(issue.id)).selectedStoryIds).toEqual([story.id])
    mockInvoke.mockResolvedValueOnce({ intro: 'A hopeful week.' })
    const { content } = await lifecycle.generateContent(issue.id)
    expect(content).toContain(`## Cities cut smog {story:${story.id}}`)

    const html = await lifecycle.generateHtml(issue.id)
    expect(html).toContain('/newsletter/week-9-2026')
    expect(await issueOf(issue.id)).toMatchObject({ html, slug: 'week-9-2026', status: 'draft' })
  })

  it('answers 404 for an unknown issue and 400 for missing inputs', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000'
    await expect(lifecycle.generateHtml(unknown)).rejects.toMatchObject({ status: 404 })
    await expect(editNewsletter(unknown, { title: 'x' })).rejects.toMatchObject({ status: 404 })

    const empty = await createNewsletter()
    await expect(lifecycle.selectStories(empty.id)).rejects.toMatchObject({ status: 400, message: 'No stories in longlist' })
    await expect(lifecycle.generateContent(empty.id)).rejects.toMatchObject({ status: 400, message: 'No stories selected' })
    await expect(lifecycle.generateHtml(empty.id)).rejects.toMatchObject({ status: 400, message: 'No content to convert' })
  })

  // ──── Delete ────

  it('refuses to delete a sent issue and keeps its sends; deletes an unsent one with its test and failed sends', async () => {
    const sent = await testedIssue()
    await sendLive(sent.id)
    await expect(deleteNewsletter(sent.id)).rejects.toMatchObject({ status: 409, code: 'sent_issue' })
    expect(await prisma.newsletterSend.count({ where: { newsletterId: sent.id } })).toBe(2)

    const unsent = await testedIssue()
    await createSend({ newsletterId: unsent.id, isTest: false, status: 'failed' })
    await deleteNewsletter(unsent.id)
    expect(await prisma.newsletter.findUnique({ where: { id: unsent.id } })).toBeNull()
    expect(await prisma.newsletterSend.count({ where: { newsletterId: unsent.id } })).toBe(0)
  })

  // ──── Mark as not sent ────

  it('marks only an unconfirmed live send as not sent', async () => {
    const issue = await testedIssue()
    const confirmed = await sendLive(issue.id)
    const [test] = await prisma.newsletterSend.findMany({ where: { newsletterId: issue.id, isTest: true } })

    await expect(markSendFailed(issue.id, confirmed.id)).rejects.toMatchObject({ status: 409, code: 'not_unconfirmed' })
    await expect(markSendFailed(issue.id, test!.id)).rejects.toMatchObject({ status: 409, code: 'not_unconfirmed' })
    const other = await createNewsletter()
    await expect(markSendFailed(other.id, confirmed.id)).rejects.toMatchObject({ status: 404 })
    expect((await liveRowsOf(issue.id))[0]!.status).toBe('sending')
  })

  // ──── Publish and unpublish ────

  it('dates the first publish of an emailed issue by its first live send, and keeps the date', async () => {
    const issue = await builtIssue({ title: 'Week 41, 2026' })
    await createSend({ newsletterId: issue.id, isTest: false, status: 'sending', sentAt: new Date('2026-10-11T07:00:00Z') })
    await createSend({ newsletterId: issue.id, isTest: false, status: 'failed', sentAt: new Date('2026-10-01T07:00:00Z') })

    expect(await publishNewsletter(issue.id)).toMatchObject({ status: 'published', slug: 'week-41-2026', publishedAt: new Date('2026-10-11T07:00:00Z') })
    expect(await unpublishNewsletter(issue.id)).toMatchObject({ status: 'draft', slug: 'week-41-2026', publishedAt: new Date('2026-10-11T07:00:00Z') })
    expect((await publishNewsletter(issue.id)).publishedAt).toEqual(new Date('2026-10-11T07:00:00Z'))
  })

  it('dates an issue first sent as a scheduled send by when that send was made', async () => {
    const issue = await builtIssue()
    await createSend({ newsletterId: issue.id, isTest: false, status: 'sending', sentAt: new Date('2026-10-11T07:00:00Z') })
    // Scheduled: no sentAt of its own
    await createSend({ newsletterId: issue.id, isTest: false, status: 'scheduled', createdAt: new Date('2026-10-10T18:00:00Z') })

    expect((await publishNewsletter(issue.id)).publishedAt).toEqual(new Date('2026-10-10T18:00:00Z'))
  })

  it('dates the first publish of an issue never emailed by the publish time', async () => {
    const issue = await builtIssue()
    const before = Date.now()

    const published = await publishNewsletter(issue.id)

    expect(published.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(await publishNewsletter(issue.id)).toEqual(published)
  })

  // ──── Test sends ────

  it('refuses a test send without a test segment and never calls Plunk', async () => {
    const issue = await builtIssue()
    config.plunk.testSegmentId = ''

    await expect(sendTest(issue.id)).rejects.toBeInstanceOf(lifecycle.TestSegmentNotConfiguredError)
    expect(fakePlunk.campaigns).toEqual([])
  })

  it('sends a test to the test segment only and records it as sent with its HTML', async () => {
    const issue = await builtIssue()

    const send = await sendTest(issue.id)

    expect(fakePlunk.campaigns).toEqual([expect.objectContaining({ audienceType: 'SEGMENT', segmentId: 'seg-test', subject: '[TEST] Week 8, 2026' })])
    expect(fakePlunk.liveSends()).toEqual([])
    expect(send).toMatchObject({ isTest: true, status: 'sent', htmlContent: HTML })
  })
})
