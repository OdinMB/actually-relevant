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
  findContactsByEmail: vi.fn(),
  hasComplaintOrBounce: vi.fn(),
  sendTransactional: vi.fn(),
  verifyEmail: vi.fn(),
}

const mockCheckSendAllowance = vi.fn()

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./plunk.js', () => mockPlunk)
vi.mock('./subscribeLimits.js', () => ({
  checkSendAllowance: (...args: unknown[]) => mockCheckSendAllowance(...args),
}))

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }))

const { subscribe, confirmSubscription, EmailValidationError, ConfirmationEmailError } = await import('./subscribe.js')

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
    // A confirmed address is still subscribed unless a test says otherwise
    mockPlunk.findContactsByEmail.mockResolvedValue([{ id: 'contact-1', email: 'x@example.com', subscribed: true, snoozedUntil: null }])
    mockPlunk.hasComplaintOrBounce.mockResolvedValue(false)
    mockPlunk.sendTransactional.mockResolvedValue(undefined)
    mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: true, isDisposable: false })
  })

  describe('logging', () => {
    const allLogged = () => JSON.stringify([mockLogger.info, mockLogger.warn, mockLogger.error, mockLogger.debug].flatMap(fn => fn.mock.calls))

    it('logs no email address on signup, a queued signup, a failed send or a failed verification', async () => {
      await subscribe({ email: 'person@example.com' })
      mockCheckSendAllowance.mockResolvedValueOnce('queue')
      await subscribe({ email: 'person@example.com' })
      mockPlunk.verifyEmail.mockRejectedValueOnce(new Error('verify down'))
      mockPlunk.sendTransactional.mockRejectedValueOnce(new Error('send down'))
      await subscribe({ email: 'person@example.com' }).catch(() => {})

      expect(mockLogger.info).toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
      expect(allLogged()).not.toContain('person@example.com')
    })

    it('logs no email address when confirming, logging the subscription id instead', async () => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        email: 'person@example.com',
        confirmedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        plunkContactId: null,
      })
      mockPlunk.createContact.mockRejectedValueOnce(new Error('plunk down'))
      await confirmSubscription('token', 'person@example.com')

      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub-1' }), 'subscription confirmed')
      expect(allLogged()).not.toContain('person@example.com')
    })
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

    it('accepts a signup the limits queue: a row that waits for its email, and no send', async () => {
      mockCheckSendAllowance.mockResolvedValue('queue')
      mockPrisma.pendingSubscription.create.mockResolvedValue({ id: 'row-q' })

      await expect(subscribe({ email: 'test@example.com' })).resolves.toBeUndefined()

      const data = mockPrisma.pendingSubscription.create.mock.calls[0][0].data
      expect(data).toMatchObject({ email: 'test@example.com', sentAt: null })
      expect(data.token).toEqual(expect.any(String))
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.delete).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'row-q' }), expect.stringMatching(/queued/))
    })

    it('runs the address checks on a queued signup as on one sent at once', async () => {
      mockCheckSendAllowance.mockResolvedValue('queue')
      const callOrder: string[] = []
      mockPlunk.verifyEmail.mockImplementation(async () => {
        callOrder.push('verify')
        return { valid: true, domainExists: true, isDisposable: false }
      })
      mockPrisma.pendingSubscription.deleteMany.mockImplementation(async () => {
        callOrder.push('deleteMany')
        return { count: 0 }
      })
      mockPrisma.pendingSubscription.create.mockImplementation(async () => {
        callOrder.push('create')
        return { id: 'row-q' }
      })

      await subscribe({ email: 'test@example.com' })
      expect(callOrder).toEqual(['verify', 'deleteMany', 'create'])

      mockPlunk.verifyEmail.mockResolvedValue({ valid: true, domainExists: true, isDisposable: true })
      await expect(subscribe({ email: 'temp@mailinator.com' })).rejects.toThrow(EmailValidationError)
      expect(mockPrisma.pendingSubscription.create).toHaveBeenCalledTimes(1)
    })

    it('marks a row sent at once as sent', async () => {
      await subscribe({ email: 'test@example.com' })

      expect(mockPrisma.pendingSubscription.create.mock.calls[0][0].data.sentAt).toBeInstanceOf(Date)
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

    it('asks Plunk nothing for an address that never confirmed', async () => {
      await subscribe({ email: 'new@example.com' })

      expect(mockPlunk.findContactsByEmail).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).toHaveBeenCalled()
    })
  })

  describe('a confirmed address (a returning reader)', () => {
    const contact = (fields: { subscribed: unknown; snoozedUntil?: string | null; id?: unknown }) => ({
      id: 'contact-1',
      email: 'back@example.com',
      snoozedUntil: null,
      ...fields,
    })

    beforeEach(() => {
      mockPrisma.pendingSubscription.findFirst.mockResolvedValue({ id: 'old-row', confirmedAt: new Date('2026-03-01T00:00:00Z') })
      mockPrisma.pendingSubscription.create.mockResolvedValue({ id: 'new-row' })
    })

    it('asks Plunk, once, about the normalized address', async () => {
      await subscribe({ email: ' Back@Example.com ' })

      expect(mockPlunk.findContactsByEmail).toHaveBeenCalledTimes(1)
      expect(mockPlunk.findContactsByEmail).toHaveBeenCalledWith('back@example.com')
    })

    it('sends nothing and writes nothing while Plunk still has the address subscribed', async () => {
      mockPlunk.findContactsByEmail.mockResolvedValue([contact({ subscribed: true })])

      await expect(subscribe({ email: 'back@example.com' })).resolves.toBeUndefined()

      expect(mockCheckSendAllowance).not.toHaveBeenCalled()
      expect(mockPlunk.verifyEmail).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it.each([
      ['Plunk has them unsubscribed', [contact({ subscribed: false })]],
      ['Plunk has no contact for the address', []],
    ])('signs them up like a first-time signup when %s', async (_label, contacts) => {
      mockPlunk.findContactsByEmail.mockResolvedValue(contacts)

      await subscribe({ email: 'back@example.com' })

      expect(mockCheckSendAllowance).toHaveBeenCalledWith('back@example.com')
      expect(mockPlunk.verifyEmail).toHaveBeenCalledWith('back@example.com')
      // The earlier confirmed row stays: only unconfirmed rows are replaced
      expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({ where: { email: 'back@example.com', confirmedAt: null } })
      expect(mockPrisma.pendingSubscription.create.mock.calls[0][0].data).toMatchObject({ email: 'back@example.com', sentAt: expect.any(Date) })
      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
      expect(mockPlunk.sendTransactional.mock.calls[0][0].to).toBe('back@example.com')
    })

    it("signs them up only after Plunk shows no spam complaint or bounce on each contact's record", async () => {
      mockPlunk.findContactsByEmail.mockResolvedValue([contact({ subscribed: false }), contact({ subscribed: false, id: 'contact-2' })])
      const callOrder: string[] = []
      mockPlunk.hasComplaintOrBounce.mockImplementation(async (id: string) => {
        callOrder.push(`activity ${id}`)
        return false
      })
      mockCheckSendAllowance.mockImplementation(async () => {
        callOrder.push('limits')
        return 'ok'
      })

      await subscribe({ email: 'back@example.com' })

      expect(callOrder).toEqual(['activity contact-1', 'activity contact-2', 'limits'])
      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    })

    it('reads no activity when Plunk has no contact for the address, or the address is still subscribed', async () => {
      mockPlunk.findContactsByEmail.mockResolvedValueOnce([])
      await subscribe({ email: 'back@example.com' })
      mockPlunk.findContactsByEmail.mockResolvedValueOnce([contact({ subscribed: true })])
      await subscribe({ email: 'back@example.com' })

      expect(mockPlunk.hasComplaintOrBounce).not.toHaveBeenCalled()
    })

    it.each([
      [
        'Plunk has a spam complaint or a bounce on record for their contact',
        [contact({ subscribed: false })],
        () => mockPlunk.hasComplaintOrBounce.mockResolvedValue(true),
      ],
      [
        'one of their two contacts has a complaint or a bounce on record',
        [contact({ subscribed: false }), contact({ subscribed: false, id: 'contact-2' })],
        () => mockPlunk.hasComplaintOrBounce.mockImplementation(async (id: string) => id === 'contact-2'),
      ],
      [
        'the activity read fails',
        [contact({ subscribed: false })],
        () => mockPlunk.hasComplaintOrBounce.mockRejectedValue(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } })),
      ],
      [
        'their contact carries no id to read its activity by',
        [contact({ subscribed: false, id: undefined })],
        // As the client does: no id, no request (an unfiltered read would be the whole account's)
        () =>
          mockPlunk.hasComplaintOrBounce.mockImplementation(async (id: unknown) => {
            if (!id) throw new Error('hasComplaintOrBounce: no contact id')
            return false
          }),
      ],
    ])('sends nothing, writes nothing and warns without the address when %s', async (_label, contacts, arrange) => {
      mockPlunk.findContactsByEmail.mockResolvedValue(contacts)
      arrange()

      await expect(subscribe({ email: 'back@example.com' })).resolves.toBeUndefined()

      expect(mockCheckSendAllowance).not.toHaveBeenCalled()
      expect(mockPlunk.verifyEmail).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'old-row' }), expect.stringMatching(/Plunk/))
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('back@example.com')
    })

    it('applies the send limits to them: an address emailed within the window gets nothing more', async () => {
      mockPlunk.findContactsByEmail.mockResolvedValue([contact({ subscribed: false })])
      mockCheckSendAllowance.mockResolvedValue('address-limited')

      await subscribe({ email: 'back@example.com' })

      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it('queues them like anyone else when the hour is full', async () => {
      mockPlunk.findContactsByEmail.mockResolvedValue([contact({ subscribed: false })])
      mockCheckSendAllowance.mockResolvedValue('queue')

      await subscribe({ email: 'back@example.com' })

      expect(mockPrisma.pendingSubscription.create.mock.calls[0][0].data).toMatchObject({ email: 'back@example.com', sentAt: null })
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it.each([
      ['snoozed (Plunk resubscribes them when the snooze ends)', [contact({ subscribed: false, snoozedUntil: '2026-12-01T00:00:00Z' })]],
      ['a subscribed flag that is not a boolean', [contact({ subscribed: 'yes' })]],
      ['one of two contacts for the address subscribed', [contact({ subscribed: false }), contact({ subscribed: true })]],
    ])('counts them as still subscribed, and sends nothing, when the contact is %s', async (_label, contacts) => {
      mockPlunk.findContactsByEmail.mockResolvedValue(contacts)

      await subscribe({ email: 'back@example.com' })

      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    })

    it('sends nothing, writes nothing and warns without the address when the lookup fails', async () => {
      mockPlunk.findContactsByEmail.mockRejectedValue(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }))

      await expect(subscribe({ email: 'back@example.com' })).resolves.toBeUndefined()

      expect(mockCheckSendAllowance).not.toHaveBeenCalled()
      expect(mockPrisma.pendingSubscription.create).not.toHaveBeenCalled()
      expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'old-row' }), expect.stringMatching(/Plunk/))
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('back@example.com')
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
