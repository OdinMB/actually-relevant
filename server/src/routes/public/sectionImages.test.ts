import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import helmet from 'helmet'
import request from 'supertest'

const mockPrisma = vi.hoisted(() => ({ issue: { findFirst: vi.fn() } }))
vi.mock('../../lib/prisma.js', () => ({ default: mockPrisma }))
// The drawing has its own tests (services/sectionImage.test.ts): here, what is drawn and how it is served
const createSectionImage = vi.hoisted(() => vi.fn(async (label: { text: string }) => Buffer.from(`png:${label.text}`)))
vi.mock('../../services/sectionImage.js', () => ({ createSectionImage }))
// A limiter that refuses everything, to show where the route sits
vi.mock('../../middleware/rateLimit.js', () => ({
  apiLimiter: (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => res.status(429).json({ error: 'limited' }),
  searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

const { sectionImageRouter } = await import('./sectionImages.js')
const { default: publicRouter } = await import('./index.js')
const { _resetSectionImageCache, sectionImage, topicImage } = await import('../../services/sectionPreview.js')
const { SECTION_IMAGE_MOUNT } = await import('../../lib/linkPreviewPaths.js')
const { config } = await import('../../config.js')

const app = express().use(helmet()).use(SECTION_IMAGE_MOUNT, sectionImageRouter)
const viaPublicApi = express().use('/api', publicRouter)

/** The path part of an absolute image URL, as the route sees it. */
const pathOf = (url: string) => new URL(url).pathname

beforeEach(() => {
  vi.clearAllMocks()
  _resetSectionImageCache()
  mockPrisma.issue.findFirst.mockResolvedValue(null)
})

describe('the section images', () => {
  it.each([
    ['newsletter', 'Newsletter'],
    ['podcast', 'Podcast'],
  ] as const)('serves the %s image, naming the section, as a cacheable image other sites may show', async (section, text) => {
    const res = await request(app)
      .get(pathOf(sectionImage(section).url))
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe(`public, max-age=${config.storyPreview.imageCacheSeconds}`)
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(res.body.toString()).toBe(`png:${text}`)
    expect(createSectionImage).toHaveBeenCalledWith({ text })
    expect(mockPrisma.issue.findFirst).not.toHaveBeenCalled()
  })

  it("serves the newsletter image with the website's AI badge for an issue card whose title is AI-written", async () => {
    const res = await request(app)
      .get(pathOf(sectionImage('newsletter-issue').url))
      .buffer(true)
    expect(res.status).toBe(200)
    expect(pathOf(sectionImage('newsletter-issue').url)).toBe('/api/section-images/newsletter-issue.png')
    expect(createSectionImage).toHaveBeenCalledWith({ text: 'Newsletter', badge: 'AI' })
  })

  it('names each image by an absolute URL on the API with its size and type', () => {
    expect(sectionImage('newsletter')).toEqual({ url: `${config.apiUrl}/api/section-images/newsletter.png`, type: 'image/png', width: 1200, height: 630 })
    expect(topicImage('planet-climate')).toEqual({
      url: `${config.apiUrl}/api/section-images/issues/planet-climate.png`,
      type: 'image/png',
      width: 1200,
      height: 630,
    })
  })

  it('renders an image once while it is cached', async () => {
    await request(app).get('/api/section-images/newsletter.png')
    await request(app).get('/api/section-images/newsletter.png')
    expect(createSectionImage).toHaveBeenCalledOnce()
  })

  it('answers 404 for a section without an image', async () => {
    for (const path of ['/api/section-images/stories.png', '/api/section-images/toString.png', '/api/section-images/newsletter.jpg']) {
      expect((await request(app).get(path)).status, path).toBe(404)
    }
    expect(createSectionImage).not.toHaveBeenCalled()
  })
})

describe('the topic images', () => {
  it("names a top-level topic beside a dot in the topic's color", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ name: 'Planet & Climate', slug: 'planet-climate', parent: null })
    const res = await request(app)
      .get(pathOf(topicImage('planet-climate').url))
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(createSectionImage).toHaveBeenCalledWith({ text: 'Planet & Climate', accent: '#2dd4bf' })
    expect(mockPrisma.issue.findFirst.mock.calls[0][0].where).toEqual({ slug: 'planet-climate' })
  })

  it("gives a subtopic its parent's color", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ name: 'Pandemics', slug: 'pandemics', parent: { slug: 'existential-threats' } })
    await request(app).get('/api/section-images/issues/pandemics.png')
    expect(createSectionImage).toHaveBeenCalledWith({ text: 'Pandemics', accent: '#f87171' })
  })

  it('answers 404 for a topic that does not exist, and asks again next time', async () => {
    expect((await request(app).get('/api/section-images/issues/nothing-here.png')).status).toBe(404)
    await request(app).get('/api/section-images/issues/nothing-here.png')
    expect(mockPrisma.issue.findFirst).toHaveBeenCalledTimes(2)
    expect(createSectionImage).not.toHaveBeenCalled()
  })

  it('reads a topic once while its image is cached', async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ name: 'Pandemics', slug: 'pandemics', parent: { slug: 'existential-threats' } })
    await request(app).get('/api/section-images/issues/pandemics.png')
    await request(app).get('/api/section-images/issues/pandemics.png')
    expect(mockPrisma.issue.findFirst).toHaveBeenCalledOnce()
  })
})

describe('the mount', () => {
  it('is served under the public API, behind the shared rate limiter like the story images', async () => {
    expect((await request(viaPublicApi).get('/api/section-images/newsletter.png')).status).toBe(429)
  })
})
