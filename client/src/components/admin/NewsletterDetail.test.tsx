import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Newsletter, NewsletterSend, Story } from '@shared/types'
import { ToastProvider } from '../ui/Toast'

const mockNewsletters = vi.hoisted(() => ({ listSends: vi.fn(), markSendFailed: vi.fn() }))
const mockStories = vi.hoisted(() => ({ batch: vi.fn(), newerCoverage: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { newsletters: mockNewsletters, stories: mockStories },
}))

import { NewsletterDetail } from './NewsletterDetail'

const HTML = '<p>v1</p>'

const issue = (overrides: Partial<Newsletter> = {}): Newsletter => ({
  id: 'nl-1',
  title: 'Week 8, 2026',
  content: '## A story',
  html: HTML,
  storyIds: [],
  selectedStoryIds: [],
  status: 'draft',
  slug: 'week-8-2026',
  publishedAt: null,
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  ...overrides,
})

const send = (overrides: Partial<NewsletterSend>): NewsletterSend => ({
  id: 'send-1',
  newsletterId: 'nl-1',
  plunkCampaignId: 'c1',
  isTest: false,
  status: 'sending',
  htmlContent: HTML,
  stats: {},
  errorMessage: null,
  sentAt: null,
  createdAt: '2026-10-24T00:00:00Z',
  updatedAt: '2026-10-24T00:00:00Z',
  ...overrides,
})

function renderDetail(newsletter: Newsletter) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <NewsletterDetail newsletter={newsletter} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const sendLiveButton = async () => {
  await waitFor(() => expect(screen.queryByText(/Loading send history/)).toBeNull())
  return button('Send to Subscribers')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStories.batch.mockResolvedValue([])
  mockStories.newerCoverage.mockResolvedValue([])
})

const story = (id: string, title: string) => ({ id, title, sourceTitle: title, dateCrawled: '2026-10-20T00:00:00Z', relevance: 7 }) as Story

describe('NewsletterDetail', () => {
  it('locks building and editing of a sent, published issue, but not unpublishing it', async () => {
    mockNewsletters.listSends.mockResolvedValue([send({ status: 'sending' }), send({ id: 'test', isTest: true, status: 'sent' })])
    renderDetail(issue({ status: 'published' }))

    expect(await sendLiveButton()).toBeDisabled()
    for (const name of ['Generate Longlist', 'Select Stories', 'Generate Content', 'Generate HTML', 'Rename']) expect(button(name), name).toBeDisabled()
    for (const edit of screen.getAllByRole('button', { name: 'Edit' })) expect(edit).toBeDisabled()
    expect(button('Unpublish')).toBeEnabled()
    expect(button('Send Test')).toBeEnabled()
  })

  it('leaves a sent issue that is unpublished open for editing, and never sendable again', async () => {
    mockNewsletters.listSends.mockResolvedValue([send({ status: 'sending' }), send({ id: 'test', isTest: true, status: 'sent' })])
    renderDetail(issue())

    expect(await sendLiveButton()).toBeDisabled()
    expect(button('Generate Content')).toBeEnabled()
  })

  it('allows the live send only after a test email of the current HTML', async () => {
    mockNewsletters.listSends.mockResolvedValue([send({ id: 'test', isTest: true, status: 'sent', htmlContent: '<p>older</p>' })])
    const { unmount } = renderDetail(issue())
    expect(await sendLiveButton()).toBeDisabled()
    unmount()

    mockNewsletters.listSends.mockResolvedValue([send({ id: 'test', isTest: true, status: 'sent' })])
    renderDetail(issue())
    expect(await sendLiveButton()).toBeEnabled()
  })

  it('marks an unconfirmed send as not sent after a confirmation', async () => {
    mockNewsletters.listSends.mockResolvedValue([send({ id: 'live', status: 'draft', errorMessage: 'Plunk may have accepted this send' })])
    mockNewsletters.markSendFailed.mockResolvedValue(send({ id: 'live', status: 'failed' }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderDetail(issue())

    expect(await sendLiveButton()).toBeDisabled()
    expect(button('Generate Content')).toBeDisabled()
    await userEvent.click(button('Mark as not sent'))
    expect(mockNewsletters.markSendFailed).not.toHaveBeenCalled()
    await userEvent.click(button('Mark as not sent'))

    await waitFor(() => expect(mockNewsletters.markSendFailed).toHaveBeenCalledWith('nl-1', 'live'))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('flags a selected story that newer coverage may have overtaken, linking the newer story, and still allows the send', async () => {
    mockNewsletters.listSends.mockResolvedValue([send({ id: 'test', isTest: true, status: 'sent' })])
    mockStories.batch.mockResolvedValue([story('s1', 'US orders total blockade of key oil route'), story('s2', 'Wetlands bill passes')])
    mockStories.newerCoverage.mockResolvedValue([
      {
        storyId: 's1',
        newer: [{ id: 's9', title: 'US orders blockade of Iranian ports', publisher: 'Wire A', reportedAt: '2026-10-29T10:00:00Z', reason: 'same_event' }],
      },
    ])
    renderDetail(issue({ selectedStoryIds: ['s1', 's2'] }))

    const newerLink = await screen.findByRole('link', { name: 'US orders blockade of Iranian ports' })
    expect(newerLink).toHaveAttribute('href', '/admin/stories/s9')
    expect(mockStories.newerCoverage).toHaveBeenCalledWith(['s1', 's2'])
    const flaggedRow = screen.getByRole('link', { name: 'US orders total blockade of key oil route' }).closest('tr')!
    expect(flaggedRow).toContainElement(newerLink)
    const quietRow = screen.getByRole('link', { name: 'Wetlands bill passes' }).closest('tr')!
    expect(quietRow).not.toHaveTextContent('Newer coverage')
    expect(await sendLiveButton()).toBeEnabled()
  })
})
