import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewsletterCrossLink, PodcastCrossLink, PodcastShowCrossLink, StoryProductButtons } from './CrossLinks'
import { PositivityProvider } from '../contexts/PositivityContext'
import { TEXT_LINK } from '../lib/control-classes'
import { focusRingProblems } from '../test/classes'

const mockApi = vi.hoisted(() => ({ podcast: vi.fn() }))
vi.mock('../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  publicApi: mockApi,
}))

function withProviders(children: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PositivityProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </PositivityProvider>
    </MemoryRouter>,
  )
}

function renderLines() {
  return withProviders(
    <>
      <PodcastCrossLink />
      <NewsletterCrossLink />
      <StoryProductButtons />
    </>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockApi.podcast.mockResolvedValue({ show: {}, episodes: [], upliftingShowOpen: true })
})

/** Every in-sentence control in the two lines, by accessible name. */
const LINE_CONTROLS = [
  ['link', 'Try the weekly podcast'],
  ['button', 'Get the weekly newsletter'],
  ['link', 'read past issues'],
] as const

/** The story page's two buttons. */
const BUTTON_CONTROLS = [
  ['button', 'Newsletter'],
  ['link', 'Podcast'],
] as const

describe('CrossLinks', () => {
  it.each([...LINE_CONTROLS, ...BUTTON_CONTROLS])('%s "%s" keeps its name and shows only the brand ring, on keyboard focus', (role, name) => {
    renderLines()
    const control = screen.getByRole(role, { name })
    expect(focusRingProblems(control)).toEqual([])
  })

  it.each(LINE_CONTROLS)('%s "%s" uses the shared in-sentence link style', (role, name) => {
    renderLines()
    expect(screen.getByRole(role, { name })).toHaveClass(...TEXT_LINK.split(' '))
  })

  it.each(BUTTON_CONTROLS)('%s "%s" on story pages is a button, not an in-sentence link', (role, name) => {
    renderLines()
    const control = screen.getByRole(role, { name })
    expect(control).not.toHaveClass('underline')
    expect(control).toHaveClass('rounded-md', 'border', 'min-h-11')
  })
})

describe('PodcastCrossLink and the Actually Uplifting podcast', () => {
  it('offers the main podcast outside the edition, without asking whether the other show is public', () => {
    withProviders(<PodcastCrossLink />)
    expect(screen.getByRole('link', { name: 'Try the weekly podcast' })).toHaveAttribute('href', '/podcast')
    expect(mockApi.podcast).not.toHaveBeenCalled()
  })

  it('offers the Actually Uplifting podcast inside the edition once that show is public', async () => {
    withProviders(<PodcastCrossLink />, '/newsletter?mix=uplifting')
    expect(await screen.findByRole('link', { name: 'Try the Actually Uplifting podcast' })).toHaveAttribute('href', '/podcast/uplifting')
  })

  it('keeps the main podcast inside the edition while Actually Uplifting is switched off', async () => {
    mockApi.podcast.mockResolvedValue({ show: {}, episodes: [], upliftingShowOpen: false })
    withProviders(<PodcastCrossLink />, '/newsletter?mix=uplifting')
    await vi.waitFor(() => expect(mockApi.podcast).toHaveBeenCalledWith('full'))
    expect(screen.getByRole('link', { name: 'Try the weekly podcast' })).toHaveAttribute('href', '/podcast')
  })
})

describe('PodcastShowCrossLink', () => {
  it.each([
    ['full', 'Listen to Actually Uplifting', '/podcast/uplifting'],
    ['uplifting', 'listen to Actually Relevant', '/podcast'],
  ] as const)('on the %s show points to the other one', (edition, name, href) => {
    withProviders(<PodcastShowCrossLink edition={edition} />)
    const link = screen.getByRole('link', { name })
    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveClass(...TEXT_LINK.split(' '))
    expect(focusRingProblems(link)).toEqual([])
  })
})

describe('focusRingProblems', () => {
  const el = (className: string) => {
    const a = document.createElement('a')
    a.className = className
    return a
  }

  it('flags a ring the browser outline draws beside, a missing ring, and a ring on mouse focus', () => {
    expect(focusRingProblems(el('focus-visible:ring-2 focus-visible:ring-brand-500'))).toEqual(['no focus-visible:outline-none'])
    expect(focusRingProblems(el('focus-visible:outline-none'))).toEqual(['no focus-visible:ring-2', 'no focus-visible:ring-brand-500'])
    expect(focusRingProblems(el('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus:ring-2'))).toEqual([
      'focus:ring-2 shows on a mouse click too',
    ])
    expect(focusRingProblems(el('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'))).toEqual([])
  })
})
