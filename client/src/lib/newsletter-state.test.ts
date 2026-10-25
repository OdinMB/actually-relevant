import { describe, it, expect } from 'vitest'
import type { NewsletterSend } from '@shared/types'
import { newsletterSendState } from './newsletter-state'

const send = (overrides: Partial<NewsletterSend>): NewsletterSend => ({
  id: 's',
  newsletterId: 'n',
  plunkCampaignId: null,
  isTest: false,
  status: 'sending',
  htmlContent: '<p>v1</p>',
  stats: {},
  errorMessage: null,
  sentAt: null,
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  ...overrides,
})

describe('newsletterSendState', () => {
  it('freezes an issue that was sent and is published, not one that was sent and unpublished', () => {
    const sends = [send({ status: 'sending' })]
    expect(newsletterSendState({ status: 'published', html: '<p>v1</p>' }, sends)).toMatchObject({ liveSent: true, frozen: true })
    expect(newsletterSendState({ status: 'draft', html: '<p>v1</p>' }, sends)).toMatchObject({ liveSent: true, frozen: false })
  })

  it('freezes an issue with an unconfirmed send, published or not', () => {
    expect(newsletterSendState({ status: 'draft', html: '<p>v1</p>' }, [send({ status: 'draft' })])).toMatchObject({
      unconfirmed: true,
      liveSent: true,
      frozen: true,
    })
  })

  it('does not count failed live sends or test sends as sent', () => {
    const sends = [send({ status: 'failed' }), send({ isTest: true, status: 'sent' })]
    expect(newsletterSendState({ status: 'published', html: '<p>v1</p>' }, sends)).toMatchObject({ liveSent: false, frozen: false })
  })

  it('counts a test as current only when it was sent with the current HTML', () => {
    const html = '<p>v2</p>'
    expect(newsletterSendState({ status: 'draft', html }, [send({ isTest: true, status: 'sent', htmlContent: '<p>v1</p>' })]).testCurrent).toBe(false)
    expect(newsletterSendState({ status: 'draft', html }, [send({ isTest: true, status: 'failed', htmlContent: html })]).testCurrent).toBe(false)
    expect(newsletterSendState({ status: 'draft', html }, [send({ isTest: false, status: 'sent', htmlContent: html })]).testCurrent).toBe(false)
    expect(newsletterSendState({ status: 'draft', html }, [send({ isTest: true, status: 'sent', htmlContent: html })]).testCurrent).toBe(true)
    expect(newsletterSendState({ status: 'draft', html: '' }, [send({ isTest: true, status: 'sent', htmlContent: '' })]).testCurrent).toBe(false)
    expect(newsletterSendState({ status: 'draft', html }, undefined)).toEqual({ liveSent: false, unconfirmed: false, frozen: false, testCurrent: false })
  })
})
