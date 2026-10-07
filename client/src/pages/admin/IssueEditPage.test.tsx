import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link } from 'react-router-dom'
import type { Issue } from '@shared/types'
import { renderAdminRoutes, reloadIsHeld, Where } from '../../test/admin'

const mockApi = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { issues: mockApi },
}))

import IssueEditPage from './IssueEditPage'

const issue = {
  id: 'issue-1',
  name: 'Planet & Climate',
  slug: 'planet-climate',
  description: 'Climate.',
  promptFactors: 'Factors.',
  promptAntifactors: 'Antifactors.',
  promptRatings: 'Ratings.',
  parentId: null,
  intro: 'Intro.',
  evaluationIntro: '',
  evaluationCriteria: ['One'],
  makeADifference: [{ label: 'Act', url: 'https://example.org' }],
  children: [],
  sourceNames: [],
} as unknown as Issue

function renderEditor(path: string) {
  const page = <><Link to="/admin/feeds">Feeds</Link><IssueEditPage /><Where /></>
  return renderAdminRoutes(
    [
      { path: '/admin/issues/new', element: page },
      { path: '/admin/issues/:id/edit', element: page },
      { path: '*', element: <Where /> },
    ],
    { history: ['/admin/issues', path] },
  )
}

const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.list.mockResolvedValue([issue])
  mockApi.get.mockResolvedValue(issue)
})

describe('IssueEditPage unsaved changes', () => {
  it('treats a loaded issue as clean: Back leaves at once and a reload is not held', async () => {
    const { router } = renderEditor('/admin/issues/issue-1/edit')
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Planet & Climate'))
    expect(reloadIsHeld()).toBe(false)
    await act(() => router.navigate(-1))
    await waitFor(() => expect(where()).toBe('/admin/issues'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('holds Back, a link and a reload once a loaded issue is edited', async () => {
    const { router } = renderEditor('/admin/issues/issue-1/edit')
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Planet & Climate'))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed.' } })
    expect(reloadIsHeld()).toBe(true)

    await act(() => router.navigate(-1))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(where()).toBe('/admin/issues/issue-1/edit')

    fireEvent.click(screen.getByRole('link', { name: 'Feeds' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(where()).toBe('/admin/feeds'))
  })

  it('holds leaving a new issue once something is typed, not before', async () => {
    renderEditor('/admin/issues/new')
    expect(reloadIsHeld()).toBe(false)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Health' } })
    expect(reloadIsHeld()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Back to Issues/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(where()).toBe('/admin/issues/new')
  })

  it('goes back to the list without asking after a save', async () => {
    mockApi.update.mockResolvedValue({ ...issue, description: 'Changed.' })
    renderEditor('/admin/issues/issue-1/edit')
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Planet & Climate'))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(where()).toBe('/admin/issues'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
