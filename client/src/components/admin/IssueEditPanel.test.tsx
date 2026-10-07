import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link } from 'react-router-dom'
import type { Issue } from '@shared/types'
import { renderAdminRoutes, reloadIsHeld, Where } from '../../test/admin'

const mockApi = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { issues: mockApi },
}))

import { IssueEditPanel } from './IssueEditPanel'

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

/** The Issues list with the panel open on one issue, as its Edit button leaves it. */
function renderList() {
  return renderAdminRoutes(
    [
      {
        path: '/admin/issues',
        element: <><Link to="/admin/feeds">Feeds</Link><IssueEditPanel issueId="issue-1" onClose={() => {}} /><Where /></>,
      },
      { path: '*', element: <Where /> },
    ],
    { history: ['/admin', '/admin/issues'] },
  )
}

const where = () => screen.getByTestId('where').textContent
const discardDialog = () => screen.findByRole('dialog', { name: /unsaved changes/ })

async function loaded() {
  await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Planet & Climate'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.list.mockResolvedValue([issue])
  mockApi.get.mockResolvedValue(issue)
})

describe('IssueEditPanel unsaved changes', () => {
  it('lets Back through at once while the loaded issue is unedited', async () => {
    const { router } = renderList()
    await loaded()
    expect(reloadIsHeld()).toBe(false)
    await act(() => router.navigate(-1))
    await waitFor(() => expect(where()).toBe('/admin'))
  })

  it('holds Back and a link once the issue is edited: cancel keeps the edit, discard leaves', async () => {
    const { router } = renderList()
    await loaded()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed.' } })
    expect(reloadIsHeld()).toBe(true)

    await act(() => router.navigate(-1))
    fireEvent.click(within(await discardDialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /unsaved changes/ })).toBeNull())
    expect(where()).toBe('/admin/issues')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Changed.')

    fireEvent.click(screen.getByRole('link', { name: 'Feeds', hidden: true }))
    fireEvent.click(within(await discardDialog()).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(where()).toBe('/admin/feeds'))
  })
})
