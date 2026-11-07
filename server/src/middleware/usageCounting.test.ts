import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { Router } from 'express'
import request from 'supertest'

const mockSend = vi.hoisted(() => vi.fn<(event: unknown) => Promise<void>>())
vi.mock('../lib/simpleAnalytics.js', () => ({ sendAnalyticsEvent: mockSend }))

const { config } = await import('../config.js')
const { countUsage } = await import('./usageCounting.js')

/** The app's shape where it matters: the counter at the app level, the routes in routers mounted below it. */
function buildApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(countUsage)
  const stories = Router()
  stories.get('/', (_req, res) => {
    res.json({ data: [] })
  })
  stories.get('/:slug', (_req, res) => {
    res.json({ id: 'story-1' })
  })
  const api = Router()
  api.use('/stories', stories)
  app.use('/api', api)
  return app
}

/** Long enough for a response's `finish` handlers to have run. */
const settle = () => new Promise(resolve => setImmediate(resolve))

const originalFrontendUrl = process.env.FRONTEND_URL

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue(undefined)
  config.simpleAnalytics.eventsEnabled = true
  process.env.FRONTEND_URL = 'https://actuallyrelevant.news'
})

afterEach(() => {
  config.simpleAnalytics.eventsEnabled = false
  process.env.FRONTEND_URL = originalFrontendUrl
})

describe('countUsage', () => {
  it('sends nothing while the switch is off', async () => {
    config.simpleAnalytics.eventsEnabled = false
    await request(buildApp()).get('/api/stories').set('Origin', 'https://news.example.org').expect(200)
    await settle()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('counts an outside call once its response has finished, by the route it was routed to', async () => {
    await request(buildApp()).get('/api/stories/a-story-slug').set('Origin', 'https://news.example.org').expect(200)
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    expect(mockSend).toHaveBeenCalledWith({ event: 'api_request', metadata: { route: '/api/stories/:slug', caller: 'news.example.org', status: 200 } })
  })

  it("sends none of the caller's IP address, user agent, query values or the requested slug", async () => {
    await request(buildApp())
      .get('/api/stories/jane-does-story?search=jane%20doe%20diagnosis&page=2')
      .set('Origin', 'https://news.example.org')
      .set('X-Forwarded-For', '198.51.100.23')
      .set('User-Agent', 'Mozilla/5.0 (JaneDoeLaptop)')
      .expect(200)
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    const sent = JSON.stringify(mockSend.mock.calls)
    for (const personal of ['198.51.100.23', 'JaneDoeLaptop', 'Mozilla', 'diagnosis', 'jane', 'page']) expect(sent).not.toContain(personal)
  })

  it('counts a widget load as a widget_view with its issue filter, and nothing else', async () => {
    await request(buildApp()).get('/api/stories?pageSize=3&page=1&issueSlug=planet-climate&ref=widget').set('Origin', 'https://blog.example.com').expect(200)
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
    await settle()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith({ event: 'widget_view', metadata: { site: 'blog.example.com', issue: 'planet-climate' } })
  })

  it('counts nothing from the site FRONTEND_URL names', async () => {
    await request(buildApp()).get('/api/stories').set('Origin', 'https://actuallyrelevant.news').expect(200)
    await settle()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('counts nothing for a browser sending Do Not Track or Global Privacy Control', async () => {
    await request(buildApp()).get('/api/stories').set('Origin', 'https://news.example.org').set('DNT', '1').expect(200)
    await request(buildApp()).get('/api/stories').set('Origin', 'https://news.example.org').set('Sec-GPC', '1').expect(200)
    await settle()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never holds up the response, even when the send never completes', async () => {
    mockSend.mockReturnValue(new Promise<void>(() => {}))
    const res = await request(buildApp()).get('/api/stories').set('Origin', 'https://news.example.org')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [] })
  })
})
