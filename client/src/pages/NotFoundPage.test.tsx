import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import NotFoundPage from './NotFoundPage'

describe('NotFoundPage', () => {
  it('says the page was not found and keeps itself out of search results', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/no-such-page']}>
          <NotFoundPage />
        </MemoryRouter>
      </HelmetProvider>,
    )

    expect(screen.getByText('Page not found.')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Page Not Found - Actually Relevant'))
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex')
  })
})
