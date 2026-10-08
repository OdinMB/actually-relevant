import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAxiosPost = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post: mockAxiosPost } }))

const mockRecordNotice = vi.hoisted(() => vi.fn())
vi.mock('../services/adminNotices.js', () => ({ recordNotice: mockRecordNotice }))

const { notify, jobFailureNotice } = await import('./notify.js')
const { config } = await import('../config.js')

const WEBHOOK = 'https://hooks.example.com/webhook'
const notice = {
  source: 'podcast' as const,
  severity: 'info' as const,
  title: 'Podcast episode ready',
  message: 'Week 41, 5:42',
  link: '/admin/podcasts/pod-1',
}

describe('notify', () => {
  const originalEnv = process.env.WEBHOOK_URL

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WEBHOOK_URL
    mockRecordNotice.mockResolvedValue(true)
    mockAxiosPost.mockResolvedValue({ status: 200 })
  })

  afterEach(() => {
    if (originalEnv !== undefined) process.env.WEBHOOK_URL = originalEnv
    else delete process.env.WEBHOOK_URL
  })

  it('records the notice and posts nothing without WEBHOOK_URL', async () => {
    await notify(notice)
    expect(mockRecordNotice).toHaveBeenCalledWith(notice, {})
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('records and then forwards when WEBHOOK_URL is set, with the absolute link in the text', async () => {
    process.env.WEBHOOK_URL = WEBHOOK
    await notify(notice)
    expect(mockRecordNotice).toHaveBeenCalledOnce()
    const [url, payload] = mockAxiosPost.mock.calls[0]
    expect(url).toBe(WEBHOOK)
    expect(payload).toMatchObject({ title: notice.title, message: notice.message, source: 'podcast', severity: 'info' })
    expect(payload.text).toContain(`${config.clientUrl}/admin/podcasts/pod-1`)
    expect(payload.content).toContain(`${config.clientUrl}/admin/podcasts/pod-1`)
  })

  it('passes the record options through (insert-only)', async () => {
    await notify(notice, { reopen: false })
    expect(mockRecordNotice).toHaveBeenCalledWith(notice, { reopen: false })
  })

  it('does not forward an insert-only repeat that was skipped', async () => {
    process.env.WEBHOOK_URL = WEBHOOK
    mockRecordNotice.mockResolvedValueOnce(false)
    await notify(notice, { reopen: false })
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('still posts when recording fails (the database is down) and does not throw', async () => {
    process.env.WEBHOOK_URL = WEBHOOK
    mockRecordNotice.mockRejectedValueOnce(new Error('db down'))
    await expect(notify(notice)).resolves.toBeUndefined()
    expect(mockAxiosPost).toHaveBeenCalledOnce()
  })

  it('resolves when the post fails', async () => {
    process.env.WEBHOOK_URL = WEBHOOK
    mockAxiosPost.mockRejectedValueOnce(new Error('network error'))
    await expect(notify(notice)).resolves.toBeUndefined()
  })
})

describe('jobFailureNotice', () => {
  it('files newsletter and podcast jobs under their product, with its page', () => {
    expect(jobFailureNotice('generate_newsletter', 'x')).toMatchObject({ source: 'newsletter', link: '/admin/newsletters' })
    expect(jobFailureNotice('generate_podcast', 'x')).toMatchObject({ source: 'podcast', link: '/admin/podcasts' })
    expect(jobFailureNotice('publish_podcast', 'x')).toMatchObject({ source: 'podcast', link: '/admin/podcasts' })
  })

  it('files every other job under jobs, keyed by job name', () => {
    expect(jobFailureNotice('crawl_feeds', 'timeout')).toMatchObject({
      source: 'jobs', severity: 'warning', link: '/admin/jobs', message: 'timeout', dedupeKey: 'job-failure:crawl_feeds',
    })
  })
})
