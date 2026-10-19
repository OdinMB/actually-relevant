import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  bluesky: { handle: 'bot.example.com', appPassword: 'app-pass', serviceUrl: 'https://bsky.social' },
}))
const agent = vi.hoisted(() => ({
  login: vi.fn(),
  post: vi.fn(),
  uploadBlob: vi.fn(),
  getPostThread: vi.fn(),
  deletePost: vi.fn(),
  getAuthorFeed: vi.fn(),
}))
const AgentCtor = vi.hoisted(() => vi.fn())

vi.mock('../config.js', () => ({ config: mockConfig }))
vi.mock('./logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('./retry.js', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))
vi.mock('@atproto/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atproto/api')>()
  return {
    ...actual, // real RichText and the AppBsky* type guards
    AtpAgent: class {
      constructor(opts: unknown) {
        AgentCtor(opts)
        return agent
      }
    },
  }
})

// The module keeps its agent and session between calls: load a fresh copy per test
async function load() {
  vi.resetModules()
  return import('./bluesky.js')
}

const linkCard = { uri: 'https://actuallyrelevant.news/stories/s', title: 'Title', description: 'Blurb' }

function imageResponse(bytes: number, type = 'image/png') {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.bluesky.handle = 'bot.example.com'
  mockConfig.bluesky.appPassword = 'app-pass'
  agent.login.mockResolvedValue(undefined)
  agent.post.mockResolvedValue({ uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'cid1' })
  agent.uploadBlob.mockResolvedValue({ data: { blob: { ref: 'blob-ref' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('session handling', () => {
  it('refuses to call Bluesky without credentials', async () => {
    mockConfig.bluesky.appPassword = ''
    const bsky = await load()
    expect(bsky.isBlueskyConfigured()).toBe(false)
    await expect(bsky.deletePost('at://x')).rejects.toThrow('Bluesky credentials not configured')
    expect(agent.login).not.toHaveBeenCalled()
  })

  it('logs in once and reuses the session', async () => {
    const bsky = await load()
    await bsky.deletePost('at://a')
    await bsky.deletePost('at://b')
    expect(AgentCtor).toHaveBeenCalledWith({ service: 'https://bsky.social' })
    expect(agent.login).toHaveBeenCalledTimes(1)
    expect(agent.login).toHaveBeenCalledWith({ identifier: 'bot.example.com', password: 'app-pass' })
    expect(agent.deletePost).toHaveBeenCalledTimes(2)
  })

  it('logs in again and retries once when the session has expired (401)', async () => {
    const bsky = await load()
    agent.deletePost.mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 })).mockResolvedValueOnce(undefined)

    await bsky.deletePost('at://a')

    expect(agent.login).toHaveBeenCalledTimes(2)
    expect(agent.deletePost).toHaveBeenCalledTimes(2)
  })

  it('passes other errors on without logging in again', async () => {
    const bsky = await load()
    agent.deletePost.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }))
    await expect(bsky.deletePost('at://a')).rejects.toThrow('bad request')
    expect(agent.login).toHaveBeenCalledTimes(1)
  })
})

describe('createPost', () => {
  it('links the publisher name at its UTF-8 byte offsets and attaches the link card', async () => {
    const bsky = await load()
    vi.stubGlobal('fetch', vi.fn())
    const text = 'Café opens — read more at Le Monde'

    const result = await bsky.createPost(text, linkCard, 'Le Monde', 'https://lemonde.fr/a')

    expect(result).toEqual({ uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'cid1' })
    const record = agent.post.mock.calls[0][0]
    const byteStart = new TextEncoder().encode(text.slice(0, text.lastIndexOf('Le Monde'))).length
    expect(record.facets).toContainEqual({
      index: { byteStart, byteEnd: byteStart + 8 },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://lemonde.fr/a' }],
    })
    expect(record.embed).toEqual({ $type: 'app.bsky.embed.external', external: linkCard })
    expect(record.text).toBe(text)
    expect(fetch).not.toHaveBeenCalled() // no thumbUrl
  })

  it('uploads the thumbnail and puts its blob on the card', async () => {
    const bsky = await load()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(2000, 'image/jpeg')))

    await bsky.createPost('Title Pub', { ...linkCard, thumbUrl: 'https://actuallyrelevant.news/images/og-image.png' }, 'Pub', 'https://pub.example')

    expect(agent.uploadBlob).toHaveBeenCalledWith(expect.any(Buffer), { encoding: 'image/jpeg' })
    expect(agent.post.mock.calls[0][0].embed.external.thumb).toEqual({ ref: 'blob-ref' })
  })

  it('posts without a thumbnail when the image is over the 1 MB blob limit or the fetch fails', async () => {
    const bsky = await load()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(imageResponse(1_000_001)).mockRejectedValueOnce(new Error('timeout')))
    const card = { ...linkCard, thumbUrl: 'https://actuallyrelevant.news/images/og-image.png' }

    await bsky.createPost('One Pub', card, 'Pub', 'https://pub.example')
    await bsky.createPost('Two Pub', card, 'Pub', 'https://pub.example')

    expect(agent.uploadBlob).not.toHaveBeenCalled()
    expect(agent.post).toHaveBeenCalledTimes(2)
    expect(agent.post.mock.calls[0][0].embed.external).not.toHaveProperty('thumb')
  })
})

describe('getPostMetrics', () => {
  it('reads the counts from a thread view, defaulting missing ones to 0', async () => {
    const bsky = await load()
    agent.getPostThread.mockResolvedValue({
      data: { thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: { likeCount: 4, repostCount: 2 } } },
    })

    expect(await bsky.getPostMetrics('at://p')).toEqual({ likeCount: 4, repostCount: 2, replyCount: 0, quoteCount: 0 })
    expect(agent.getPostThread).toHaveBeenCalledWith({ uri: 'at://p', depth: 0 })
  })

  it('throws for a deleted or blocked post', async () => {
    const bsky = await load()
    agent.getPostThread.mockResolvedValue({ data: { thread: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'at://p', notFound: true } } })
    await expect(bsky.getPostMetrics('at://p')).rejects.toThrow('Unexpected thread type: app.bsky.feed.defs#notFoundPost')
  })
})

describe('getAuthorFeed', () => {
  it("maps the account's posts, marking reposts and reading external link cards", async () => {
    const bsky = await load()
    agent.getAuthorFeed.mockResolvedValue({
      data: {
        cursor: 'next',
        feed: [
          {
            post: {
              uri: 'at://1', cid: 'c1', indexedAt: '2026-10-01T00:00:00Z', likeCount: 3,
              record: { text: 'Hello', createdAt: '2026-09-30T23:59:00Z' },
              embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://x', title: 'T', description: 'D', thumb: 'https://cdn/t.jpg' } },
            },
          },
          {
            post: { uri: 'at://2', cid: 'c2', indexedAt: '2026-10-02T00:00:00Z', record: {} },
            reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
          },
        ],
      },
    })

    const result = await bsky.getAuthorFeed(undefined, 10)

    expect(agent.getAuthorFeed).toHaveBeenCalledWith({ actor: 'bot.example.com', limit: 10, filter: 'posts_no_replies' })
    expect(result.cursor).toBe('next')
    expect(result.items[0]).toEqual({
      uri: 'at://1', cid: 'c1', text: 'Hello', createdAt: '2026-09-30T23:59:00Z', indexedAt: '2026-10-01T00:00:00Z',
      likeCount: 3, repostCount: 0, replyCount: 0, quoteCount: 0, isRepost: false,
      embed: { uri: 'https://x', title: 'T', description: 'D', thumbUrl: 'https://cdn/t.jpg' },
    })
    expect(result.items[1]).toMatchObject({ text: '', createdAt: '2026-10-02T00:00:00Z', isRepost: true, embed: undefined })
  })

  it('passes the cursor on when given', async () => {
    const bsky = await load()
    agent.getAuthorFeed.mockResolvedValue({ data: { feed: [] } })
    await bsky.getAuthorFeed('abc')
    expect(agent.getAuthorFeed).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'abc', limit: 25 }))
  })
})
