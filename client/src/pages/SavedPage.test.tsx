import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SavedPage from './SavedPage'
import { DefaultSeo } from '../lib/seo'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/saved']}>
        <QueryClientProvider client={client}>
          {/* The site-wide defaults the app renders above every page */}
          <DefaultSeo />
          <SavedPage />
        </QueryClientProvider>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

function headContent(selector: string): (string | null)[] {
  return Array.from(document.head.querySelectorAll(selector)).map(el => el.getAttribute('content'))
}

describe('SavedPage', () => {
  it("gives link previews the page's own title, description and URL, not the homepage's, and no article author", async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Saved Stories' })).toBeInTheDocument()

    await waitFor(() => {
      expect(headContent('meta[property="og:url"]')).toEqual(['https://actuallyrelevant.news/saved'])
    })
    expect(headContent('meta[property="og:title"]')).toEqual(['Saved Stories - Actually Relevant'])
    expect(headContent('meta[property="og:description"]')).toEqual(['Your saved stories on Actually Relevant.'])
    expect(headContent('meta[name="description"]')).toEqual(['Your saved stories on Actually Relevant.'])
    expect(headContent('meta[property="article:author"]')).toEqual([])
  })
})
