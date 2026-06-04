import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
const mockPrisma = {
  pendingSubscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
}

const mockPlunk = {
  createContact: vi.fn(),
  sendTransactional: vi.fn(),
  verifyEmail: vi.fn(),
}

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./plunk.js', () => mockPlunk)

const { subscribe, confirmSubscription, EmailValidationError, ConfirmationEmailError } =
  await import('./subscribe.js')

describe('subscribe service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.pendingSubscription.findFirst.mockResolvedValue(null)
    mockPrisma.pendingSubscription.create.mockResolvedValue({ id: '1' })
    mockPrisma.pendingSubscription.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.pendingSubscription.update.mockResolvedValue({ id: '1' })
    mockPlunk.createContact.mockResolvedValue({ id: 'contact-1' })
    mockPlunk.sendTransactional.mockResolvedValue(undefined)
    mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: true, isDisposable: false })
  })

  describe('subscribe() — deferred contact creation', () => {
    it('does NOT create a Plunk contact during signup', async () => {
      await subscribe({ email: 'test@example.com' })

      expect(mockPlunk.createContact).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).toHaveBeenCalled()
    })

    it('creates the pending subscription without a plunkContactId', async () => {
      await subscribe({ email: 'test@example.com' })

      const data = mockPrisma.pendingSubscription.create.mock.calls[0][0].data
      expect(data).toMatchObject({ email: 'test@example.com' })
      expect(data.plunkContactId).toBeUndefined()
    })

    it('verifies email before sending the confirmation email', async () => {
      const callOrder: string[] = []
      mockPlunk.verifyEmail.mockImplementation(async () => {
        callOrder.push('verify')
        return { valid: true, domainExists: true, isDisposable: false }
      })
      mockPlunk.sendTransactional.mockImplementation(async () => {
        callOrder.push('send')
      })

      await subscribe({ email: 'test@example.com' })

      expect(callOrder).toEqual(['verify', 'send'])
    })

    it('throws ConfirmationEmailError when the confirmation email fails to send', async () => {
      mockPlunk.sendTransactional.mockRejectedValue(new Error('Request failed with status code 403'))

      await expect(subscribe({ email: 'test@example.com' })).rejects.toThrow(ConfirmationEmailError)
    })
  })

  describe('email verification', () => {
    it('throws EmailValidationError when email is invalid', async () => {
      mockPlunk.verifyEmail.mockResolvedValue({ valid: false, domainExists: true, isDisposable: false })
      await expect(subscribe({ email: 'bad@example.com' })).rejects.toThrow(EmailValidationError)
    })

    it('throws EmailValidationError when domain does not exist', async () => {
      mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: false, isDisposable: false })
      await expect(subscribe({ email: 'user@nodomain.fake' })).rejects.toThrow(EmailValidationError)
    })

    it('throws EmailValidationError for disposable emails', async () => {
      mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: true, isDisposable: true })
      await expect(subscribe({ email: 'temp@mailinator.com' })).rejects.toThrow(EmailValidationError)
    })

    it('skips verification gracefully and still subscribes when the verify API errors', async () => {
      // Plunk /v1/verify returns 403 in production; a verify failure must NOT block signups.
      mockPlunk.verifyEmail.mockRejectedValue(new Error('Request failed with status code 403'))

      await subscribe({ email: 'test@example.com' })

      expect(mockPrisma.pendingSubscription.create).toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).toHaveBeenCalled()
    })
  })

  describe('firstName handling', () => {
    it('personalizes the greeting with the first name', async () => {
      await subscribe({ email: 'test@example.com', firstName: 'Jane' })

      const emailBody = mockPlunk.sendTransactional.mock.calls[0][0].body
      expect(emailBody).toContain('Hi Jane,')
    })

    it('uses a plain greeting when no first name is provided', async () => {
      await subscribe({ email: 'test@example.com' })

      const emailBody = mockPlunk.sendTransactional.mock.calls[0][0].body
      expect(emailBody).toContain('Hi,')
      expect(emailBody).not.toContain('Jane')
    })

    it('strips URLs and markup from the first name in the greeting', async () => {
      await subscribe({ email: 'test@example.com', firstName: 'Cheap pills http://spam.com <b>buy</b>' })

      const emailBody = mockPlunk.sendTransactional.mock.calls[0][0].body
      // The sanitized name appears in the greeting; the URL and markup are gone.
      expect(emailBody).toContain('Hi Cheap pills buy,')
      expect(emailBody).not.toContain('spam.com')
      expect(emailBody).not.toContain('<b>buy</b>')
    })
  })

  describe('existing subscription', () => {
    it('returns early if already confirmed', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({ confirmedAt: new Date() })

      await subscribe({ email: 'existing@example.com' })

      expect(mockPlunk.verifyEmail).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })
  })

  describe('re-subscribe (unconfirmed)', () => {
    it('deletes existing unconfirmed entries before creating a new one', async () => {
      mockPrisma.pendingSubscription.deleteMany.mockResolvedValue({ count: 1 })

      await subscribe({ email: 'retry@example.com' })

      expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({
        where: { email: 'retry@example.com', confirmedAt: null },
      })
      expect(mockPrisma.pendingSubscription.create).toHaveBeenCalled()
    })

    it('deletes unconfirmed entries only after email verification', async () => {
      const callOrder: string[] = []
      mockPlunk.verifyEmail.mockImplementation(async () => {
        callOrder.push('verify')
        return { valid: true, domainExists: true, isDisposable: false }
      })
      mockPrisma.pendingSubscription.deleteMany.mockImplementation(async () => {
        callOrder.push('deleteMany')
        return { count: 0 }
      })

      await subscribe({ email: 'test@example.com' })

      expect(callOrder).toEqual(['verify', 'deleteMany'])
    })

    it('skips re-subscribe cleanup when already confirmed', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({ confirmedAt: new Date() })

      await subscribe({ email: 'confirmed@example.com' })

      expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('confirmSubscription()', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const past = new Date(Date.now() - 60 * 60 * 1000)

    it('creates a subscribed Plunk contact and marks confirmed', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'p1',
        token: 't',
        email: 'new@example.com',
        confirmedAt: null,
        expiresAt: future,
        plunkContactId: null,
      })

      await confirmSubscription('t', 'new@example.com')

      expect(mockPlunk.createContact).toHaveBeenCalledWith({ email: 'new@example.com', subscribed: true })
      const update = mockPrisma.pendingSubscription.update.mock.calls[0][0]
      expect(update.where).toEqual({ id: 'p1' })
      expect(update.data.plunkContactId).toBe('contact-1')
      expect(update.data.confirmedAt).toBeInstanceOf(Date)
    })

    it('is idempotent when already confirmed (no second contact created)', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'p1',
        confirmedAt: past,
        expiresAt: future,
      })

      await confirmSubscription('t', 'done@example.com')

      expect(mockPlunk.createContact).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.update).not.toHaveBeenCalled()
    })

    it('throws on an invalid token', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue(null)
      await expect(confirmSubscription('bad', 'x@example.com')).rejects.toThrow('Invalid confirmation link')
    })

    it('throws on an expired token without creating a contact', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'p1',
        confirmedAt: null,
        expiresAt: past,
      })

      await expect(confirmSubscription('t', 'x@example.com')).rejects.toThrow('expired')
      expect(mockPlunk.createContact).not.toHaveBeenCalled()
    })

    it('still confirms locally if the Plunk contact creation fails', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'p1',
        confirmedAt: null,
        expiresAt: future,
        plunkContactId: null,
      })
      mockPlunk.createContact.mockRejectedValue(new Error('Plunk down'))

      await confirmSubscription('t', 'x@example.com')

      const update = mockPrisma.pendingSubscription.update.mock.calls[0][0]
      expect(update.data.confirmedAt).toBeInstanceOf(Date)
      expect(update.data.plunkContactId).toBeNull()
    })
  })
})
