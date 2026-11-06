import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPlunk = vi.hoisted(() => ({ getContact: vi.fn(), updateContact: vi.fn() }))
const mockNotify = vi.hoisted(() => vi.fn())
const mockRecordSwitch = vi.hoisted(() => vi.fn())
vi.mock('./plunk.js', () => mockPlunk)
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('./knownEditions.js', () => ({ recordSwitch: mockRecordSwitch }))

const { switchEdition } = await import('./editionSwitch.js')
const { config } = await import('../config.js')

const contact = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'contact-1',
  email: 'reader@example.com',
  subscribed: true,
  data,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
})

describe('switchEdition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotify.mockResolvedValue(undefined)
    mockPlunk.updateContact.mockResolvedValue({})
    mockRecordSwitch.mockResolvedValue(undefined)
    config.plunk.fullEditionSegmentId = 'seg-full'
    config.plunk.upliftingSegmentId = 'seg-up'
  })
  afterEach(() => {
    config.plunk.fullEditionSegmentId = ''
    config.plunk.upliftingSegmentId = ''
  })

  it('refuses while the editions are closed, asking Plunk nothing', async () => {
    config.plunk.upliftingSegmentId = ''
    await expect(switchEdition('contact-1', 'uplifting')).rejects.toMatchObject({ status: 409, code: 'closed' })
    expect(mockPlunk.getContact).not.toHaveBeenCalled()
  })

  it("refuses a link Plunk did not fill in, and tells the owner once per key, without the link's value", async () => {
    await expect(switchEdition('{{id}}', 'uplifting')).rejects.toMatchObject({ status: 400, code: 'broken_link' })
    expect(mockPlunk.getContact).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'subscriptions',
        severity: 'warning',
        title: 'Edition switch link not filled in by Plunk',
        dedupeKey: 'edition-switch-link-broken',
      }),
    )
  })

  it('refuses a contact Plunk does not have', async () => {
    mockPlunk.getContact.mockResolvedValue(null)
    await expect(switchEdition('contact-1', 'uplifting')).rejects.toMatchObject({ status: 404, code: 'unknown_contact' })
  })

  it('never writes a contact that is not subscribed, so a switch resubscribes nobody', async () => {
    for (const status of [{ subscribed: false }, { subscribed: false, snoozedUntil: '2026-12-01T00:00:00Z' }, { subscribed: 'yes' }]) {
      mockPlunk.getContact.mockResolvedValue(contact({}, status))
      await expect(switchEdition('contact-1', 'uplifting')).rejects.toMatchObject({ status: 409, code: 'not_subscribed' })
    }
    expect(mockPlunk.updateContact).not.toHaveBeenCalled()
    expect(mockRecordSwitch).not.toHaveBeenCalled()
  })

  // The closed-editions guard reads the local record (knownEditions.ts), so it must never say full
  // while Plunk may have the reader on Actually Uplifting
  it('records a switch to Actually Uplifting before writing Plunk, so a write Plunk applied but did not answer still counts', async () => {
    mockPlunk.getContact.mockResolvedValue(contact({ edition: 'full' }))
    mockPlunk.updateContact.mockRejectedValue(Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }))

    await expect(switchEdition('contact-1', 'uplifting')).rejects.toThrow('no answer')

    expect(mockRecordSwitch).toHaveBeenCalledWith('contact-1', 'uplifting')
  })

  it('records a switch to the full edition only once Plunk has it', async () => {
    mockPlunk.getContact.mockResolvedValue(contact({ edition: 'uplifting' }))
    mockPlunk.updateContact.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }))

    await expect(switchEdition('contact-1', 'full')).rejects.toThrow('HTTP 503')
    expect(mockRecordSwitch).not.toHaveBeenCalled()

    await switchEdition('contact-1', 'full')
    expect(mockRecordSwitch).toHaveBeenCalledWith('contact-1', 'full')
    expect(mockRecordSwitch.mock.invocationCallOrder[0]).toBeGreaterThan(mockPlunk.updateContact.mock.invocationCallOrder[1]!)
  })

  it('records a switch to the edition the contact is on already, which Plunk needs no write for', async () => {
    mockPlunk.getContact.mockResolvedValue(contact({ edition: 'uplifting' }))
    await switchEdition('contact-1', 'uplifting')
    expect(mockRecordSwitch).toHaveBeenCalledWith('contact-1', 'uplifting')
  })

  it("writes the edition merged with the contact's other data fields", async () => {
    mockPlunk.getContact.mockResolvedValue(contact({ source: 'homepage', visits: 3, vip: false, nested: { a: 1 } }))

    await switchEdition('contact-1', 'uplifting')

    expect(mockPlunk.updateContact).toHaveBeenCalledWith('contact-1', { data: { source: 'homepage', visits: 3, vip: false, edition: 'uplifting' } })
  })

  it('writes nothing for a switch to the edition the contact is on', async () => {
    mockPlunk.getContact.mockResolvedValue(contact({ edition: 'full' }))
    await switchEdition('contact-1', 'full')
    expect(mockPlunk.updateContact).not.toHaveBeenCalled()
  })

  it("fails with Plunk's status only, never the request path that holds the contact id", async () => {
    mockPlunk.getContact.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 }, config: { url: '/contacts/contact-1' } }),
    )

    const err = await switchEdition('contact-1', 'uplifting').catch((e: unknown) => e)

    expect(String(err)).toContain('HTTP 503')
    expect(JSON.stringify(err)).not.toContain('contact-1')
    expect(String(err)).not.toContain('contact-1')
  })
})
