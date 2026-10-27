import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import type { PublicStory } from '@shared/types'
import { makeStory } from '../test/stories'

const mockApi = vi.hoisted(() => ({ issues: { get: vi.fn() }, stories: { list: vi.fn() } }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

import { ApiError, type PublicIssue } from '../lib/api'
import IssuePage from './IssuePage'

function makeIssue(slug: string, name: string): PublicIssue {
  return {
    id: slug,
    name,
    slug,
    description: `${name} description`,
    intro: `${name} intro`,
    evaluationIntro: '',
    evaluationCriteria: [],
    sourceNames: [],
    makeADifference: [],
    parentId: null,
    children: [],
    parent: null,
  }
}

const ISSUES: Record<string, PublicIssue> = {
  'planet-climate': makeIssue('planet-climate', 'Planet & Climate'),
  'human-development': makeIssue('human-development', 'Human Development'),
}

function page(stories: PublicStory[], pageNumber = 1, totalPages = 1) {
  return { data: stories, total: stories.length * totalPages, page: pageNumber, pageSize: 12, totalPages }
}

const climateStory = makeStory({ id: 'climate', slug: 'climate', title: 'Climate headline' })
const climateStory2 = makeStory({ id: 'climate-2', slug: 'climate-2', title: 'Second page headline' })

/** A request that stays unanswered until the test answers it. */
function pending<T>() {
  let answer: (value: T) => void = () => {}
  const promise = new Promise<T>(resolve => (answer = resolve))
  return { promise, answer }
}

function renderIssue(slug = 'planet-climate') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/issues/${slug}`]}>
        <QueryClientProvider client={client}>
          <Link to="/issues/human-development">Go to Human Development</Link>
          <Routes>
            <Route path="/issues/:slug" element={<IssuePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const EMPTY = 'No stories published yet in this category.'
const storiesFailure = () => screen.findByRole('heading', { level: 2, name: "The stories couldn't load" })

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.issues.get.mockImplementation(async (slug: string) => {
    const issue = ISSUES[slug]
    if (!issue) throw new ApiError(404, 'Issue not found')
    return issue
  })
  mockApi.stories.list.mockResolvedValue(page([climateStory]))
})

describe('IssuePage when the issue does not load', () => {
  it('says the issue was not found when the API answers 404', async () => {
    renderIssue('no-such-issue')
    expect(await screen.findByRole('heading', { level: 1, name: 'Issue Not Found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('says the issue could not load right now on any other failure, and loads it in place on "Try again"', async () => {
    mockApi.issues.get.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
    renderIssue()

    const heading = await screen.findByRole('heading', { level: 1, name: "This issue couldn't load" })
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.queryByText(/not found|does not exist/i)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Planet & Climate' })).toBeInTheDocument()
  })
})

describe('IssuePage story list', () => {
  it('says the stories could not load, under the issue heading, when the list fails', async () => {
    mockApi.stories.list.mockRejectedValue(new TypeError('Failed to fetch'))
    renderIssue()

    expect(await screen.findByRole('heading', { level: 1, name: 'Planet & Climate' })).toBeInTheDocument()
    const heading = await storiesFailure()
    expect(screen.getByRole('alert')).toContainElement(heading)
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('loads the stories in place when "Try again" succeeds', async () => {
    mockApi.stories.list.mockRejectedValueOnce(new ApiError(500, 'Failed to fetch stories')).mockResolvedValueOnce(page([climateStory]))
    renderIssue()
    await storiesFailure()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Climate headline')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a skeleton, not "no stories", while the list loads', async () => {
    mockApi.stories.list.mockReturnValue(pending().promise)
    const { container } = renderIssue()

    expect(await screen.findByRole('heading', { level: 1, name: 'Planet & Climate' })).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('says no stories are published only when the API answers with none', async () => {
    mockApi.stories.list.mockResolvedValue(page([]))
    renderIssue()
    expect(await screen.findByText(EMPTY)).toBeInTheDocument()
  })

  it('keeps the current page on screen while the next one loads', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const next = pending<ReturnType<typeof page>>()
    mockApi.stories.list.mockResolvedValueOnce(page([climateStory], 1, 2)).mockReturnValueOnce(next.promise)
    renderIssue()
    await screen.findByText('Climate headline')

    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }))

    await waitFor(() => expect(mockApi.stories.list).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Climate headline')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY)).toBeNull()

    next.answer(page([climateStory2], 2, 2))
    expect(await screen.findByText('Second page headline')).toBeInTheDocument()
    expect(screen.queryByText('Climate headline')).toBeNull()
  })

  it('keeps the failure and the focused button, not the previous page, while a failed page is tried again', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const retry = pending<ReturnType<typeof page>>()
    mockApi.stories.list
      .mockResolvedValueOnce(page([climateStory], 1, 2))
      .mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
      .mockReturnValueOnce(retry.promise)
    renderIssue()
    await screen.findByText('Climate headline')
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    await storiesFailure()
    const button = screen.getByRole('button', { name: 'Try again' })

    await userEvent.click(button)

    expect(await screen.findByRole('button', { name: 'Trying again...' })).toBe(button)
    expect(button).toHaveFocus()
    expect(screen.queryByText('Climate headline')).toBeNull()

    retry.answer(page([climateStory2], 2, 2))
    expect(await screen.findByText('Second page headline')).toBeInTheDocument()
  })

  it("never shows another issue's stories while the new issue's load", async () => {
    renderIssue()
    await screen.findByText('Climate headline')
    mockApi.stories.list.mockReturnValue(pending().promise)

    await userEvent.click(screen.getByRole('link', { name: 'Go to Human Development' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Human Development' })).toBeInTheDocument()
    expect(screen.queryByText('Climate headline')).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })
})
