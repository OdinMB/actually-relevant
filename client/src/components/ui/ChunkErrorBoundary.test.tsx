import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChunkErrorBoundary } from './ChunkErrorBoundary'

function ThrowingComponent({ error }: { error: unknown }): never {
  throw error
}

function chunkLoadError(): Error {
  return new TypeError('Failed to fetch dynamically imported module: https://actuallyrelevant.news/assets/StoryPage-a1b2c3.js')
}

function renderError(): Error {
  return new TypeError("Cannot read properties of undefined (reading 'title')")
}

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

describe('ChunkErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React error boundary console output
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error', () => {
    render(
      <ChunkErrorBoundary>
        <p>Content</p>
      </ChunkErrorBoundary>,
    )
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('says a newer version may have been deployed when a chunk fails to load', () => {
    render(
      <ChunkErrorBoundary>
        <ThrowingComponent error={chunkLoadError()} />
      </ChunkErrorBoundary>,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Failed to load page' })).toBeInTheDocument()
    expect(screen.getByText(/newer version/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Go to the homepage' })).not.toBeInTheDocument()
  })

  it.each([
    ['Firefox', new TypeError('error loading dynamically imported module: https://example.com/assets/Page.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['Safari, HTML served for a missing file', new TypeError("'text/html' is not a valid JavaScript MIME type.")],
    ['Vite CSS preload', new Error('Unable to preload CSS for /assets/Page-a1b2c3.css')],
    ['webpack ChunkLoadError', namedError('ChunkLoadError', 'Loading chunk 42 failed.')],
    ['webpack CSS chunk', new Error('Loading CSS chunk 7 failed.')],
  ])('treats a %s chunk failure as a failed download', (_source, error) => {
    render(
      <ChunkErrorBoundary>
        <ThrowingComponent error={error} />
      </ChunkErrorBoundary>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Failed to load page' })).toBeInTheDocument()
  })

  it('does not mention a deploy when the page crashed while rendering', () => {
    render(
      <ChunkErrorBoundary>
        <ThrowingComponent error={renderError()} />
      </ChunkErrorBoundary>,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText('Reload the page to try again, or go to the homepage.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/newer version/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
  })

  it('treats a thrown non-Error value as a crash', () => {
    render(
      <ChunkErrorBoundary>
        <ThrowingComponent error="Failed to fetch dynamically imported module" />
      </ChunkErrorBoundary>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
  })

  it.each([
    ['a chunk failure', chunkLoadError()],
    ['a render crash', renderError()],
  ])('calls window.location.reload when reload button is clicked after %s', async (_kind, error) => {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    })

    render(
      <ChunkErrorBoundary>
        <ThrowingComponent error={error} />
      </ChunkErrorBoundary>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }))
    expect(reloadMock).toHaveBeenCalled()
  })

  describe('with a fallback', () => {
    it('renders children when no error', () => {
      render(
        <ChunkErrorBoundary fallback={<p>Widget unavailable</p>}>
          <p>Content</p>
        </ChunkErrorBoundary>,
      )
      expect(screen.getByText('Content')).toBeInTheDocument()
      expect(screen.queryByText('Widget unavailable')).not.toBeInTheDocument()
    })

    it('shows the fallback instead of the full-page error when a child throws', () => {
      render(
        <ChunkErrorBoundary fallback={<p>Widget unavailable</p>}>
          <ThrowingComponent error={new Error('chunk failed')} />
        </ChunkErrorBoundary>,
      )
      expect(screen.getByText('Widget unavailable')).toBeInTheDocument()
      expect(screen.queryByText('Failed to load page')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    })
  })
})
