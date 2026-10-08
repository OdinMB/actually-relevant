import { describe, it, expect } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderAdminRoutes } from '../../test/admin'
import { StoryFiltersBar } from './StoryFiltersBar'

function renderBar(path: string) {
  return renderAdminRoutes([{ path: '/admin/stories', element: <StoryFiltersBar issues={[]} feeds={[]} /> }], { history: [path] })
}

const query = (search: string) => Object.fromEntries(new URLSearchParams(search))

describe('StoryFiltersBar paywall filter', () => {
  it('switches the default Published status to Rejected when Locked is picked, since locked stories are created rejected', async () => {
    const { router } = renderBar('/admin/stories?status=published&page=3')
    fireEvent.change(screen.getByLabelText('Paywall'), { target: { value: 'locked' } })
    await waitFor(() => expect(query(router.state.location.search)).toEqual({ status: 'rejected', accessTier: 'locked' }))
  })

  it('keeps any other status the editor chose', async () => {
    const { router } = renderBar('/admin/stories?status=all')
    fireEvent.change(screen.getByLabelText('Paywall'), { target: { value: 'locked' } })
    await waitFor(() => expect(query(router.state.location.search)).toEqual({ status: 'all', accessTier: 'locked' }))
  })

  it('leaves the status alone for Metered', async () => {
    const { router } = renderBar('/admin/stories?status=published')
    fireEvent.change(screen.getByLabelText('Paywall'), { target: { value: 'metered' } })
    await waitFor(() => expect(query(router.state.location.search)).toEqual({ status: 'published', accessTier: 'metered' }))
  })
})
