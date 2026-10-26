import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import DevelopersPage from './DevelopersPage'
import { DefaultSeo } from '../lib/seo'

// The Scalar reference module is held pending until the test releases it, so
// the page has to render its own content without waiting for the heavy chunk.
// That is what lets the prerenderer capture the page before Scalar has loaded.
const reference = vi.hoisted(() => {
  let release: () => void = () => {}
  const loaded = new Promise<void>(resolve => {
    release = resolve
  })
  return { loaded, release: () => release() }
})

vi.mock('../components/developers/ApiReference', async () => {
  await reference.loaded
  return {
    default: () => <div data-testid="api-reference" />,
  }
})

// Any static path from the page to Scalar (bypassing the lazy ApiReference
// chunk) would pull it back into the page chunk and fail here on import.
vi.mock('@scalar/api-reference-react', () => {
  throw new Error('Scalar must not load with the DevelopersPage chunk')
})

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/developers']}>
        {/* The site-wide defaults the app renders above every page */}
        <DefaultSeo />
        <DevelopersPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

function headContent(selector: string): (string | null)[] {
  return Array.from(document.head.querySelectorAll(selector)).map(el => el.getAttribute('content'))
}

describe('DevelopersPage', () => {
  it('renders its own content and a placeholder before the API reference loads, then swaps in the reference', async () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('api-reference-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('api-reference')).not.toBeInTheDocument()

    reference.release()

    expect(await screen.findByTestId('api-reference')).toBeInTheDocument()
    expect(screen.queryByTestId('api-reference-skeleton')).not.toBeInTheDocument()
  })

  it("gives link previews the page's own title, description and URL, not the homepage's, and no article author", async () => {
    renderPage()

    await waitFor(() => {
      expect(headContent('meta[property="og:url"]')).toEqual(['https://actuallyrelevant.news/developers'])
    })
    expect(headContent('meta[property="og:title"]')).toEqual(['API Documentation - Actually Relevant'])
    expect(headContent('meta[property="og:description"]')).toEqual([
      'Public API documentation for Actually Relevant. Access published stories, issues, and RSS feeds programmatically, with endpoints and example requests.',
    ])
    expect(headContent('meta[name="description"]')).toEqual(headContent('meta[property="og:description"]'))
    expect(headContent('meta[property="article:author"]')).toEqual([])
  })
})
