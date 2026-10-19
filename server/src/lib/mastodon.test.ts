import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  mastodon: { instanceUrl: 'https://mastodon.example', accessToken: 'token', visibility: 'unlisted' as const },
}))
const status = vi.hoisted(() => ({ fetch: vi.fn(), remove: vi.fn() }))
const accountStatuses = vi.hoisted(() => ({ list: vi.fn() }))
const client = vi.hoisted(() => ({
  v1: {
    statuses: { create: vi.fn(), $select: vi.fn(() => status) },
    accounts: { verifyCredentials: vi.fn(), $select: vi.fn(() => ({ statuses: accountStatuses })) },
  },
}))
const mockCreateClient = vi.hoisted(() => vi.fn(() => client))

vi.mock('../config.js', () => ({ config: mockConfig }))
vi.mock('./logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('./retry.js', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))
vi.mock('masto', () => ({ createRestAPIClient: mockCreateClient }))

async function load() {
  vi.resetModules() // the client is cached in the module
  return import('./mastodon.js')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.mastodon.instanceUrl = 'https://mastodon.example'
  mockConfig.mastodon.accessToken = 'token'
})

describe('client', () => {
  it('refuses to call Mastodon without credentials', async () => {
    mockConfig.mastodon.accessToken = ''
    const masto = await load()
    expect(masto.isMastodonConfigured()).toBe(false)
    await expect(masto.deleteStatus('1')).rejects.toThrow('Mastodon credentials not configured')
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('creates the client once with the instance URL and token', async () => {
    const masto = await load()
    await masto.deleteStatus('1')
    await masto.deleteStatus('2')
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledWith({ url: 'https://mastodon.example', accessToken: 'token' })
    expect(client.v1.statuses.$select).toHaveBeenCalledWith('2')
    expect(status.remove).toHaveBeenCalledTimes(2)
  })
})

describe('createStatus', () => {
  it('posts with the configured visibility and English by default', async () => {
    const masto = await load()
    client.v1.statuses.create.mockResolvedValue({ id: '9', url: 'https://mastodon.example/@bot/9' })

    expect(await masto.createStatus('Hello')).toEqual({ id: '9', url: 'https://mastodon.example/@bot/9' })
    expect(client.v1.statuses.create).toHaveBeenCalledWith({ status: 'Hello', visibility: 'unlisted', language: 'en' })
  })

  it('takes visibility and language from the options, and answers an empty url when Mastodon gives none', async () => {
    const masto = await load()
    client.v1.statuses.create.mockResolvedValue({ id: '9', url: null })

    expect(await masto.createStatus('Hallo', { visibility: 'public', language: 'de' })).toEqual({ id: '9', url: '' })
    expect(client.v1.statuses.create).toHaveBeenCalledWith({ status: 'Hallo', visibility: 'public', language: 'de' })
  })
})

describe('getStatusMetrics', () => {
  it('maps favourites, boosts and replies', async () => {
    const masto = await load()
    status.fetch.mockResolvedValue({ favouritesCount: 5, reblogsCount: 2, repliesCount: 1 })
    expect(await masto.getStatusMetrics('9')).toEqual({ favouriteCount: 5, boostCount: 2, replyCount: 1 })
    expect(client.v1.statuses.$select).toHaveBeenCalledWith('9')
  })
})

describe('getAccountStatuses', () => {
  const raw = (id: string, extra: object = {}) => ({
    id, url: `https://mastodon.example/@bot/${id}`, content: '<p>Story <a href="x">link</a></p>', createdAt: '2026-10-01T00:00:00Z',
    favouritesCount: 1, reblogsCount: 0, repliesCount: 0, reblog: null, ...extra,
  })

  it("lists the bot account's statuses as plain text, with the last id as the next page's maxId", async () => {
    const masto = await load()
    client.v1.accounts.verifyCredentials.mockResolvedValue({ id: 'acct1' })
    accountStatuses.list.mockResolvedValue([raw('3'), raw('2', { reblog: { id: 'orig' }, url: null })])

    const result = await masto.getAccountStatuses({ limit: 2 })

    expect(client.v1.accounts.$select).toHaveBeenCalledWith('acct1')
    expect(accountStatuses.list).toHaveBeenCalledWith({ limit: 2, excludeReplies: true })
    expect(result.nextMaxId).toBe('2')
    expect(result.items[0]).toEqual({
      id: '3', url: 'https://mastodon.example/@bot/3', text: 'Story link', createdAt: '2026-10-01T00:00:00Z',
      favouriteCount: 1, boostCount: 0, replyCount: 0, isReblog: false,
    })
    expect(result.items[1]).toMatchObject({ url: '', isReblog: true })
  })

  it('passes maxId on, and has no next page when the list is empty', async () => {
    const masto = await load()
    client.v1.accounts.verifyCredentials.mockResolvedValue({ id: 'acct1' })
    accountStatuses.list.mockResolvedValue([])

    const result = await masto.getAccountStatuses({ maxId: '2' })

    expect(accountStatuses.list).toHaveBeenCalledWith({ limit: 25, excludeReplies: true, maxId: '2' })
    expect(result).toEqual({ items: [], nextMaxId: undefined })
  })
})
