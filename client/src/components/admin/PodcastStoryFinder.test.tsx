import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { PodcastStoryCandidate } from '@shared/types'
import { ApiError } from '../../lib/admin-api'
import { makeStandalonePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ storySearch: vi.fn(), suggestStories: vi.fn(), saveStories: vi.fn(), active: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi, issues: { list: vi.fn().mockResolvedValue([]) } },
}))

import { PodcastStoryFinder, toStoryFilters } from './PodcastStoryFinder'
import { moveStory } from './podcastStoryDraft'

const candidate = (n: number): PodcastStoryCandidate => ({
  id: `s${n}`, title: `Story ${n}`, publisher: `Pub ${n}`, sourceUrl: `https://x.example/${n}`, slug: null, issue: `Issue ${n}`, relevance: 8, dateCrawled: '2026-09-01T10:00:00.000Z',
})

const chosenList = () => screen.queryByRole('list', { name: 'Chosen stories' })
const chosenTitles = () => (chosenList() ? within(chosenList()!).getAllByRole('listitem').map(li => li.textContent ?? '') : [])

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.active.mockResolvedValue([])
  mockApi.storySearch.mockResolvedValue({ data: [1, 2, 3, 4, 5, 6].map(candidate), total: 6, page: 1, pageSize: 20, totalPages: 1, minStories: 4, maxStories: 5 })
  mockApi.saveStories.mockImplementation(async (_id: string, storyIds: string[]) => makeStandalonePodcast({ stage: 'selected', storyIds }))
})

describe('moveStory', () => {
  it('moves a story up or down and leaves the ends alone', () => {
    expect(moveStory(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveStory(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveStory(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveStory(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})

describe('toStoryFilters', () => {
  it('sends whole UTC days and only the filters that are set', () => {
    expect(toStoryFilters({ from: '2026-09-01', to: '2026-09-30', issueId: '', search: '  ' })).toEqual({
      crawledAfter: '2026-09-01T00:00:00.000Z', crawledBefore: '2026-09-30T23:59:59.999Z',
    })
  })
})

describe('PodcastStoryFinder', () => {
  it('adds stories at the end, up to the maximum, and saves them in the chosen order', async () => {
    renderInAdmin(<PodcastStoryFinder podcast={makeStandalonePodcast()} />)
    for (const n of [3, 1, 4, 2, 5]) fireEvent.click(await screen.findByRole('button', { name: `Add Story ${n}` }))
    expect((screen.getByRole('button', { name: 'Add Story 6' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move story 2 up' }))
    expect(chosenTitles().map(t => t.match(/Story \d/)?.[0])).toEqual(['Story 1', 'Story 3', 'Story 4', 'Story 2', 'Story 5'])
    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }))
    await waitFor(() => expect(mockApi.saveStories).toHaveBeenCalledWith('pod-1', ['s1', 's3', 's4', 's2', 's5']))
  })

  it('cannot save fewer stories than the minimum', async () => {
    renderInAdmin(<PodcastStoryFinder podcast={makeStandalonePodcast()} />)
    for (const n of [1, 2, 3]) fireEvent.click(await screen.findByRole('button', { name: `Add Story ${n}` }))
    expect((screen.getByRole('button', { name: 'Save selection' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove story 1' }))
    expect(chosenTitles()).toHaveLength(2)
  })

  it('replaces the draft with the suggestion and marks it unsaved', async () => {
    mockApi.suggestStories.mockResolvedValue({ stories: [9, 8, 7, 6].map(candidate) })
    const onDirtyChange = vi.fn()
    renderInAdmin(<PodcastStoryFinder podcast={makeStandalonePodcast()} onDirtyChange={onDirtyChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Story 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suggest stories' }))
    await waitFor(() => expect(chosenTitles().map(t => t.match(/Story \d/)?.[0])).toEqual(['Story 9', 'Story 8', 'Story 7', 'Story 6']))
    expect(mockApi.suggestStories).toHaveBeenCalledWith('pod-1', {})
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect((screen.getByRole('button', { name: 'Save selection' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the message when too few stories match for a suggestion', async () => {
    mockApi.suggestStories.mockRejectedValue(new ApiError(422, 'only 2 stories match', { errors: ['only 2 stories match the filters; an episode needs 4'] }))
    renderInAdmin(<PodcastStoryFinder podcast={makeStandalonePodcast()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest stories' }))
    expect(await screen.findByText('only 2 stories match the filters; an episode needs 4')).toBeTruthy()
    expect(chosenTitles()).toEqual([])
  })

  it('searches with the applied filters from the first page', async () => {
    renderInAdmin(<PodcastStoryFinder podcast={makeStandalonePodcast()} />)
    await screen.findByRole('button', { name: 'Add Story 1' })
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'water' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(mockApi.storySearch).toHaveBeenLastCalledWith({ search: 'water' }, 1, 20))
  })
})
