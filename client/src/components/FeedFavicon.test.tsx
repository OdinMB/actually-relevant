import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import FeedFavicon, { FeedFaviconPreview } from './FeedFavicon'
import { API_BASE } from '../lib/api'

const FEED_ID = '11111111-2222-4333-8444-555555555555'
const apiUrl = `${API_BASE}/feeds/${FEED_ID}/favicon`
const committedFile = `/images/feeds/${FEED_ID}.png`

const img = (container: HTMLElement) => container.querySelector('img')

describe('FeedFavicon', () => {
  it("shows the API's stored favicon, then the file committed before favicons moved to the API, then nothing", () => {
    const { container } = render(<FeedFavicon feedId={FEED_ID} />)
    expect(img(container)).toHaveAttribute('src', apiUrl)

    fireEvent.error(img(container)!)
    expect(img(container)).toHaveAttribute('src', committedFile)

    fireEvent.error(img(container)!)
    expect(img(container)).toBeNull()
  })

  it('starts again from the API for another feed', () => {
    const other = '11111111-2222-4333-8444-000000000002'
    const { container, rerender } = render(<FeedFavicon feedId={FEED_ID} />)
    fireEvent.error(img(container)!)
    fireEvent.error(img(container)!)

    rerender(<FeedFavicon feedId={other} />)
    expect(img(container)).toHaveAttribute('src', `${API_BASE}/feeds/${other}/favicon`)
  })
})

describe('FeedFaviconPreview', () => {
  it('falls back like the public favicon, then shows a placeholder', () => {
    const { container } = render(<FeedFaviconPreview feedId={FEED_ID} />)
    expect(img(container)).toHaveAttribute('src', apiUrl)
    fireEvent.error(img(container)!)
    expect(img(container)).toHaveAttribute('src', committedFile)
    fireEvent.error(img(container)!)
    expect(img(container)).toBeNull()
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('asks the API again, past the browser cache, after a refetch, even when the last one failed', () => {
    const { container, rerender } = render(<FeedFaviconPreview feedId={FEED_ID} imgKey={0} />)
    fireEvent.error(img(container)!)
    fireEvent.error(img(container)!)

    rerender(<FeedFaviconPreview feedId={FEED_ID} imgKey={1} />)
    expect(img(container)).toHaveAttribute('src', `${apiUrl}?t=1`)
  })
})
