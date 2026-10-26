import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ClientOnErrorFunction } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { axe } from 'vitest-axe'
import RouteErrorPage, { logRouteError } from './RouteErrorPage'

const failure = new Error('stories.map is not a function')

function Boom(): never {
  throw failure
}

function renderThrowingRoute(onError?: ClientOnErrorFunction) {
  const router = createMemoryRouter([{ path: '/stories/:slug', element: <Boom />, errorElement: <RouteErrorPage /> }], {
    initialEntries: ['/stories/some-story'],
  })
  return render(
    <HelmetProvider>
      <RouterProvider router={router} onError={onError} />
    </HelmetProvider>,
  )
}

describe('RouteErrorPage', () => {
  let consoleError: MockInstance<typeof console.error>

  beforeEach(() => {
    // React and React Router report the caught error to the console
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('shows the branded page when a route throws, without the error text', async () => {
    const { container } = renderThrowingRoute()

    const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Reload the page to try again, or go to the homepage.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Actually Relevant' })).toBeInTheDocument()
    expect(screen.queryByText(/stories\.map/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument()
    expect(document.activeElement).toBe(heading)
    await waitFor(() => expect(document.title).toBe('Something Went Wrong - Actually Relevant'))
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('reloads the page from its button', async () => {
    const originalLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...originalLocation, reload }, writable: true })
    try {
      renderThrowingRoute()
      await userEvent.click(screen.getByRole('button', { name: 'Reload page' }))
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
    }
  })

  it('logs a route error once through the router onError, with its route pattern', () => {
    renderThrowingRoute(logRouteError)

    const routeErrorLogs = consoleError.mock.calls.filter(([first]) => first === 'Route error on /stories/:slug:')
    expect(routeErrorLogs).toHaveLength(1)
    expect(routeErrorLogs[0]![1]).toBe(failure)
    // React Router's own line is replaced, not repeated
    expect(consoleError.mock.calls.some(([first]) => String(first).startsWith('React Router caught'))).toBe(false)
  })
})

describe('logRouteError', () => {
  it('logs a loading error, which has no component stack, without an empty argument', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('loader failed')
    logRouteError(error, { location: { pathname: '/', search: '', hash: '', state: null, key: 'default' }, params: {}, pattern: '/' })
    expect(consoleError).toHaveBeenCalledWith('Route error on /:', error)
    consoleError.mockRestore()
  })
})
