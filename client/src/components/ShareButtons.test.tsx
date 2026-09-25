import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ShareButtons from './ShareButtons'

const BLURB = 'An AI-written blurb.'
const PREFILL = 'An AI-written blurb. (AI summary via Actually Relevant)'
const STORY_URL = 'https://actuallyrelevant.news/stories/a'

function renderButtons() {
  return render(<ShareButtons url={STORY_URL} title="AI headline" description={BLURB} />)
}

describe('ShareButtons prefill', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share')
  })

  it('says that the blurb is an AI summary in the X post text', () => {
    renderButtons()
    const href = screen.getByRole('link', { name: 'Share on X' }).getAttribute('href')!
    expect(new URL(href).searchParams.get('text')).toBe(PREFILL)
  })

  it('says it in the email body too', () => {
    renderButtons()
    const href = screen.getByRole('link', { name: 'Share via email' }).getAttribute('href')!
    expect(decodeURIComponent(href.split('body=')[1])).toBe(`${PREFILL}\n\n${STORY_URL}`)
  })

  it('says it in the native share text', () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    renderButtons()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(share).toHaveBeenCalledWith({ title: 'AI headline', text: PREFILL, url: STORY_URL })
  })
})
