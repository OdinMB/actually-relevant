import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAxiosInstance = {
  post: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}

vi.mock('axios', () => ({
  default: {
    create: () => mockAxiosInstance,
  },
}))

const {
  createCampaign,
  sendCampaign,

  getCampaignStats,
  createContact,
  updateContact,
  sendTransactional,
  verifyEmail,
  listContacts,
  parseContactsResponse,
} = await import('./plunk.js')

describe('Plunk API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createCampaign', () => {
    it('creates a campaign and returns data', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'campaign-1', name: 'Test', status: 'DRAFT' } })

      const result = await createCampaign({
        name: 'Test',
        subject: 'Subject',
        body: '<h1>Hello</h1>',
        audienceType: 'ALL',
      })

      expect(result).toEqual({ id: 'campaign-1', name: 'Test', status: 'DRAFT' })
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/campaigns',
        expect.objectContaining({ name: 'Test', subject: 'Subject', audienceType: 'ALL' }),
      )
    })
  })

  describe('sendCampaign', () => {
    it('sends immediately when no scheduledFor', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} })
      await sendCampaign('campaign-1')
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/campaigns/campaign-1/send', {})
    })

    it('schedules send when scheduledFor is provided', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} })
      await sendCampaign('campaign-1', '2025-01-15T10:00:00Z')
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/campaigns/campaign-1/send', { scheduledFor: '2025-01-15T10:00:00Z' })
    })
  })


  describe('getCampaignStats', () => {
    it('returns campaign stats', async () => {
      const stats = { delivered: 100, opened: 50, clicked: 20, bounced: 2, complained: 0 }
      mockAxiosInstance.get.mockResolvedValue({ data: stats })

      const result = await getCampaignStats('campaign-1')
      expect(result).toEqual(stats)
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/campaigns/campaign-1/stats')
    })
  })

  describe('createContact', () => {
    it('creates a contact with email and subscribed status', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'contact-1', email: 'test@example.com', subscribed: false } })

      const result = await createContact({ email: 'test@example.com', subscribed: false, data: { confirmToken: 'abc' } })
      expect(result.id).toBe('contact-1')
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/contacts', {
        email: 'test@example.com',
        subscribed: false,
        data: { confirmToken: 'abc' },
      })
    })
  })

  describe('updateContact', () => {
    it('updates a contact', async () => {
      mockAxiosInstance.patch.mockResolvedValue({ data: { id: 'contact-1', subscribed: true } })

      const result = await updateContact('contact-1', { subscribed: true })
      expect(result.subscribed).toBe(true)
    })
  })

  describe('verifyEmail', () => {
    it('calls POST /v1/verify and returns the result', async () => {
      const verifyResult = { valid: true, domainExists: true, isDisposable: false }
      mockAxiosInstance.post.mockResolvedValue({ data: verifyResult })

      const result = await verifyEmail('test@example.com')

      expect(result).toEqual(verifyResult)
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/v1/verify', { email: 'test@example.com' })
    })

    it('propagates errors from the API', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'))

      await expect(verifyEmail('bad@example.com')).rejects.toThrow('Network error')
    })
  })

  describe('sendTransactional', () => {
    it('sends a transactional email', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} })
      await sendTransactional({ to: 'test@example.com', subject: 'Confirm', body: '<p>Confirm</p>' })
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/v1/send', expect.objectContaining({
        to: 'test@example.com',
        subject: 'Confirm',
      }))
    })
  })

  describe('parseContactsResponse', () => {
    it('reads the next-api shape (array under "data", "cursor" pagination)', () => {
      const page = parseContactsResponse({
        data: [{ id: 'c1', email: 'a@x.com', subscribed: true }],
        cursor: 'nx',
        hasMore: true,
        total: 5,
      })
      expect(page.items).toHaveLength(1)
      expect(page.items[0].email).toBe('a@x.com')
      expect(page.nextCursor).toBe('nx')
      expect(page.hasMore).toBe(true)
      expect(page.total).toBe(5)
    })

    it('handles a bare array response', () => {
      const page = parseContactsResponse([{ id: 'c1', email: 'a@x.com', subscribed: false }])
      expect(page.items).toHaveLength(1)
      expect(page.nextCursor).toBeNull()
      expect(page.hasMore).toBe(false)
      expect(page.total).toBe(1)
    })

    it('infers hasMore from a cursor when the flag is absent', () => {
      expect(parseContactsResponse({ data: [], cursor: 'more' }).hasMore).toBe(true)
    })

    it('falls back to items/contacts keys and defaults total to the array length', () => {
      expect(parseContactsResponse({ items: [{ email: 'a@x.com' }] }).total).toBe(1)
      expect(parseContactsResponse({ contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }] }).items).toHaveLength(2)
    })

    it('returns an empty page for an unrecognized shape', () => {
      const page = parseContactsResponse({ weird: true })
      expect(page.items).toEqual([])
      expect(page.hasMore).toBe(false)
    })
  })

  describe('listContacts', () => {
    it('requests /contacts with the limit and parses the next-api shape', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: [{ id: 'c1', email: 'a@x.com', subscribed: true }], cursor: 'nx', hasMore: true, total: 9 },
      })

      const page = await listContacts(undefined, 50)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/contacts', { params: { limit: 50 } })
      expect(page.items).toHaveLength(1)
      expect(page.nextCursor).toBe('nx')
      expect(page.total).toBe(9)
    })

    it('passes the cursor param when paginating', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { data: [], cursor: null, hasMore: false, total: 0 } })

      await listContacts('cur123', 100)

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/contacts', { params: { limit: 100, cursor: 'cur123' } })
    })
  })
})
