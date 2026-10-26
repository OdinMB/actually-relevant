import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import DevelopersPage from './DevelopersPage'
import { OPENAPI_SPEC_URL } from '../lib/api'

// The lazy Scalar chunk fails to load, as after a deploy has replaced its hashed file.
// Its own file because a lazy component keeps its first result for the module's lifetime.
vi.mock('../components/developers/ApiReference', async () => {
  throw new Error('Failed to fetch dynamically imported module')
})

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/developers']}>
        <DevelopersPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('DevelopersPage when the API reference fails to load', () => {
  beforeEach(() => {
    // Suppress React's and the error boundary's console output for the caught error
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('keeps the page and shows an inline message in the reference spot', async () => {
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("The API reference couldn't load")
    expect(screen.queryByTestId('api-reference-skeleton')).not.toBeInTheDocument()

    // The page keeps its one h1 and its intro; nothing takes over the screen
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Actually Relevant API')
    expect(screen.getByRole('heading', { level: 2, name: 'Incremental sync' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Actually Relevant/ })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Failed to load page')).not.toBeInTheDocument()
  })

  it('links to the raw OpenAPI spec the reference reads', async () => {
    renderPage()

    await screen.findByRole('alert')
    expect(OPENAPI_SPEC_URL).toMatch(/\/api\/docs\/openapi\.json$/)
    expect(screen.getByRole('link', { name: 'OpenAPI spec as raw JSON' })).toHaveAttribute('href', OPENAPI_SPEC_URL)
  })

  it('reloads the page from the message', async () => {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    })

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Reload page' }))
    expect(reloadMock).toHaveBeenCalled()
  })
})
