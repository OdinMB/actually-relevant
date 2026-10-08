import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
const mockPrisma = {
  pendingSubscription: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}

const mockPlunk = {
  createContact: vi.fn(),
  sendTransactional: vi.fn(),
  verifyEmail: vi.fn(),
}

const mockCheckSendAllowance = vi.fn()

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./plunk.js', () => mockPlunk)
vi.mock('./subscribeLimits.js', () => ({
  checkSendAllowance: (...args: unknown[]) => mockCheckSendAllowance(...args),
}))

const {
  subscribe,
  confirmSubscription,
  EmailValidationError,
  ConfirmationEmailError,
  SignupUnavailableError,
} = await import('./subscribe.js')

describe('subscribe service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSendAllowance.mockResolvedValue('ok')
    mockPrisma.pendingSubscription.findFirst.mockResolvedValue(null)
    mockPrisma.pendingSubscription.create.mockResolvedValue({ id: '1' })
    mockPrisma.pendingSubscription.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.pendingSubscription.delete.mockResolvedValue({ id: '1' })
    mockPrisma.pendingSubscription.update.mockResolvedValue({ id: '1' })
    mockPlunk.createContact.mockResolvedValue({ id: 'contact-1' })
    mockPlunk.sendTransactional.mockResolvedValue(undefined)
    mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: true, isDisposable: false })
  })

  describe('subscribe() — no explicit createContact at signup', () => {
    // subscribe() never calls createContact itself. (A Plunk contact is still
    // created as a side effect of the confirmation email's send — Plunk creates
    // one for every /v1/send recipient — but that is not asserted here.)
    it('does not call createContact during signup (only sends the confirmation email)', async () => {
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

    it('throws ConfirmationEmailError and removes its row when the confirmation email fails to send', async () => {
      mockPrisma.pendingSubscription.create.mockResolvedValue({ id: 'row-7' })
      mockPlunk.sendTransactional.mockRejectedValue(new Error('Request failed with status code 403'))

      await expect(subscribe({ email: 'test@example.com' })).rejects.toThrow(ConfirmationEmailError)
      expect(mockPrisma.pendingSubscription.delete).toHaveBeenCalledWith({ where: { id: 'row-7' } })
    })

    it('still reports the send failure when removing the row fails too', async () => {
      mockPlunk.sendTransactional.mockRejectedValue(new Error('Plunk down'))
      mockPrisma.pendingSubscription.delete.mockRejectedValue(new Error('db down'))

      await expect(subscribe({ email: 'test@example.com' })).rejects.toThrow(ConfirmationEmailError)
    })

    it('keeps its row when the email was sent', async () => {
      await subscribe({ email: 'test@example.com' })

      expect(mockPrisma.pendingSubscription.delete).not.toHaveBeenCalled()
    })
  })

  describe('normalization', () => {
    it('looks up, stores and sends to the trimmed, lowercased address', async () => {
      await subscribe({ email: '  Victim@Example.COM ' })

      expect(mockPrisma.pendingSubscription.findFirst.mock.calls[0][0].where.email).toBe('victim@example.com')
      expect(mockCheckSendAllowance).toHaveBeenCalledWith('victim@example.com')
      expect(mockPlunk.verifyEmail).toHaveBeenCalledWith('victim@example.com')
      expect(mockPrisma.pendingSubscription.deleteMany.mock.calls[0][0].where.email).toBe('victim@example.com')
      expect(mockPrisma.pendingSubscription.create.mock.calls[0][0].data.email).toBe('victim@example.com')
      const sent = mockPlunk.sendTransactional.mock.calls[0][0]
      expect(sent.to).toBe('victim@example.com')
      expect(sent.body).toContain('email=victim%40example.com')
    })
  })

  describe('send limits', () => {
    it('sends nothing and writes nothing for an address that got an email within the window', async () => {
      mockCheckSendAllowance.mockResolvedValue('address-limited')

      await expect(subscribe({ email: 'test@example.com' })).resolves.toBeUndefined()

      expect(mockPlunk.verifyEmail).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it('refuses with SignupUnavailableError at the global cap, sending nothing', async () => {
      mockCheckSendAllowance.mockResolvedValue('global-cap')

      await expect(subscribe({ email: 'test@example.com' })).rejects.toThrow(SignupUnavailableError)

      expect(mockPlunk.verifyEmail).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it('does not consult the limits for an already-confirmed address', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({ confirmedAt: new Date() })

      await subscribe({ email: 'test@example.com' })

      expect(mockCheckSendAllowance).not.toHaveBeenCalled()
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

    it('matches the stored lowercased row from a mixed-case link', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'p1',
        confirmedAt: null,
        expiresAt: future,
        plunkContactId: null,
      })

      await confirmSubscription('t', 'Mixed@Example.com')

      expect(mockPrisma.pendingSubscription.findFirst).toHaveBeenCalledWith({
        where: { token: 't', email: 'mixed@example.com' },
      })
      expect(mockPlunk.createContact).toHaveBeenCalledWith({ email: 'mixed@example.com', subscribed: true })
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
