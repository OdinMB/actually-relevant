import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockLog = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('./logger.js', () => ({ createLogger: () => mockLog }))

const { config } = await import('../config.js')
const { sendAnalyticsEvent, SERVER_USER_AGENT, _resetAnalyticsState } = await import('./simpleAnalytics.js')

const event = { event: 'api_request', metadata: { route: '/api/stories', caller: 'news.example.org', status: 200 } }
const HOUR_MS = 60 * 60 * 1000

const fetchMock = vi.fn<typeof fetch>()

/** The fetch call's init, as the sender passed it. */
function sentInit(call = 0): RequestInit {
  const init = fetchMock.mock.calls[call]?.[1]
  if (!init) throw new Error(`no fetch call ${call}`)
  return init
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-07T10:00:00Z'))
  _resetAnalyticsState()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response('', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('sendAnalyticsEvent', () => {
  it("posts the event to Simple Analytics' server-side endpoint for the site's hostname", async () => {
    await sendAnalyticsEvent(event)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(config.simpleAnalytics.eventsUrl)
    const init = sentInit()
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'User-Agent': SERVER_USER_AGENT })
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'event',
      hostname: config.simpleAnalytics.hostname,
      event: 'api_request',
      ua: SERVER_USER_AGENT,
      metadata: { route: '/api/stories', caller: 'news.example.org', status: 200 },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('identifies itself with a user agent Simple Analytics does not count as a robot', () => {
    // Simple Analytics drops events whose ua names a bot, spider, crawler or agent, or is a library default
    expect(SERVER_USER_AGENT).not.toMatch(/bot|spider|crawl|agent|node-fetch|undici|axios|curl/i)
  })

  it('never throws: a network error or timeout, and a refused event, end quietly', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    await expect(sendAnalyticsEvent(event)).resolves.toBeUndefined()
    fetchMock.mockResolvedValueOnce(new Response('bad request', { status: 400 }))
    await expect(sendAnalyticsEvent(event)).resolves.toBeUndefined()
  })

  it('does not retry a failed send', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await sendAnalyticsEvent(event)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('warns about the first failed send in an hour and logs the rest only at debug', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await sendAnalyticsEvent(event)
    fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    await sendAnalyticsEvent(event)
    await sendAnalyticsEvent(event)
    expect(mockLog.warn).toHaveBeenCalledTimes(1)
    expect(mockLog.debug).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + HOUR_MS)
    await sendAnalyticsEvent(event)
    expect(mockLog.warn).toHaveBeenCalledTimes(2)
  })

  it('sends at most the hourly cap, notes the cap once, and sends again the next hour', async () => {
    const cap = config.simpleAnalytics.maxEventsPerHour
    for (let i = 0; i < cap + 5; i++) await sendAnalyticsEvent(event)
    expect(fetchMock).toHaveBeenCalledTimes(cap)
    expect(mockLog.warn).toHaveBeenCalledTimes(1)
    expect(String(mockLog.warn.mock.calls[0]?.at(-1))).toMatch(/cap/)

    vi.setSystemTime(Date.now() + HOUR_MS)
    await sendAnalyticsEvent(event)
    expect(fetchMock).toHaveBeenCalledTimes(cap + 1)
  })
})
