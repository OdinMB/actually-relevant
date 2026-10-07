import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAxiosPost = vi.fn()
vi.mock('axios', () => ({
  default: { post: mockAxiosPost },
}))

const { notifyJobFailure, notifyEvent, hasAlertChannel } = await import('./notify.js')

describe('hasAlertChannel', () => {
  const originalEnv = process.env.WEBHOOK_URL
  afterEach(() => {
    if (originalEnv !== undefined) process.env.WEBHOOK_URL = originalEnv
    else delete process.env.WEBHOOK_URL
  })

  it('is true only when WEBHOOK_URL is set to something', () => {
    delete process.env.WEBHOOK_URL
    expect(hasAlertChannel()).toBe(false)
    process.env.WEBHOOK_URL = ''
    expect(hasAlertChannel()).toBe(false)
    process.env.WEBHOOK_URL = 'https://hooks.example.com/webhook'
    expect(hasAlertChannel()).toBe(true)
  })
})

describe('notifyJobFailure', () => {
  const originalEnv = process.env.WEBHOOK_URL

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WEBHOOK_URL
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WEBHOOK_URL = originalEnv
    } else {
      delete process.env.WEBHOOK_URL
    }
  })

  it('does nothing when WEBHOOK_URL is not set', async () => {
    await notifyJobFailure('crawl_feeds', 'connection timeout')
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('sends POST to WEBHOOK_URL with job failure details', async () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.com/webhook'
    mockAxiosPost.mockResolvedValue({ status: 200 })

    await notifyJobFailure('crawl_feeds', 'connection timeout')

    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://hooks.example.com/webhook',
      expect.objectContaining({
        content: 'Job **crawl_feeds** failed: connection timeout',
        text: 'Job "crawl_feeds" failed: connection timeout',
        jobName: 'crawl_feeds',
        error: 'connection timeout',
        timestamp: expect.any(String),
      }),
      { timeout: 5000, maxContentLength: 1 * 1024 * 1024 },
    )
  })

  it('includes ISO timestamp in payload', async () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.com/webhook'
    mockAxiosPost.mockResolvedValue({ status: 200 })

    await notifyJobFailure('assess_stories', 'rate limit')

    const payload = mockAxiosPost.mock.calls[0][1]
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow()
  })

  it('does not throw when webhook request fails', async () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.com/webhook'
    mockAxiosPost.mockRejectedValue(new Error('network error'))

    await expect(notifyJobFailure('crawl_feeds', 'oops')).resolves.toBeUndefined()
  })
})

describe('notifyEvent', () => {
  const originalEnv = process.env.WEBHOOK_URL

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WEBHOOK_URL
  })

  afterEach(() => {
    if (originalEnv !== undefined) process.env.WEBHOOK_URL = originalEnv
    else delete process.env.WEBHOOK_URL
  })

  it('is silent without WEBHOOK_URL', async () => {
    await notifyEvent('Podcast episode ready', 'details')
    expect(mockAxiosPost).not.toHaveBeenCalled()
  })

  it('posts the title and message', async () => {
    process.env.WEBHOOK_URL = 'https://hooks.example.com/webhook'
    mockAxiosPost.mockResolvedValue({ status: 200 })
    await notifyEvent('Podcast episode ready', 'Week 41, 5:42')
    expect(mockAxiosPost).toHaveBeenCalledWith(
      'https://hooks.example.com/webhook',
      expect.objectContaining({ title: 'Podcast episode ready', message: 'Week 41, 5:42', content: '**Podcast episode ready**\nWeek 41, 5:42', timestamp: expect.any(String) }),
      { timeout: 5000, maxContentLength: 1 * 1024 * 1024 },
    )
  })
})
