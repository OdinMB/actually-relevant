import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'

const mockApi = vi.hoisted(() => ({ submitFeedback: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import FeedbackForm from './FeedbackForm'

const STORY = { id: 'story-1', title: 'Air & Health: Cities cut smog' }

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.submitFeedback.mockResolvedValue({ success: true })
})

describe('FeedbackForm', () => {
  it('offers the general categories, not the story correction, when no story is given', async () => {
    render(<FeedbackForm />)
    expect(screen.getByRole('heading', { name: 'Send feedback' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['general', 'bug', 'suggestion', 'other'])

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Nice site')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'general', message: 'Nice site' })
  })

  it('reports an error in a story: names the story, asks no category, and sends a correction with its id', async () => {
    render(<FeedbackForm story={STORY} idPrefix="feedback-modal" />)
    expect(screen.getByRole('heading', { name: 'Report an error' })).toBeInTheDocument()
    expect(screen.getByText(STORY.title)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toEqual([])

    await userEvent.type(screen.getByRole('textbox', { name: 'What is wrong?' }), 'The date is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(mockApi.submitFeedback).toHaveBeenCalledWith({ category: 'correction', message: 'The date is wrong', storyId: 'story-1' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Thanks for your report!'))
  })

  it('has no detectable accessibility violations in either form', async () => {
    const { container, unmount } = render(<FeedbackForm />)
    expect(await axe(container)).toHaveNoViolations()
    unmount()
    const bound = render(<FeedbackForm story={STORY} />)
    expect(await axe(bound.container)).toHaveNoViolations()
  })
})
