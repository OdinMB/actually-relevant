import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareButtons from './ShareButtons'
import { isBox, sizeByBreakpoint } from '../test/classes'

const BLURB = 'An AI-written blurb.'
const PREFILL = 'An AI-written blurb. (AI summary via Actually Relevant)'
const STORY_URL = 'https://actuallyrelevant.news/stories/a'

/** Every control, by accessible name, when the browser offers native sharing. */
const CONTROL_NAMES = ['Share', 'Share on X', 'Share on LinkedIn', 'Share via email', 'Copy link']

function renderButtons() {
  return render(<ShareButtons url={STORY_URL} title="AI headline" description={BLURB} />)
}

function withNativeShare() {
  Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true })
}

function withClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true })
  return navigator.clipboard.writeText as ReturnType<typeof vi.fn>
}

function controls() {
  return [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('ShareButtons tap targets', () => {
  it('keeps the accessible name of every control', () => {
    withNativeShare()
    renderButtons()
    expect(
      controls()
        .map(c => c.getAttribute('aria-label'))
        .sort(),
    ).toEqual([...CONTROL_NAMES].sort())
  })

  it('gives every control a 44px square box on phones and a 24px one from md up', () => {
    withNativeShare()
    renderButtons()
    for (const control of controls()) {
      const name = control.getAttribute('aria-label')
      expect(isBox(control), `${name} is not a box`).toBe(true)
      for (const axis of ['w', 'h'] as const) {
        const sizes = sizeByBreakpoint(control, axis)
        expect(sizes.get(''), `${name} ${axis} on phones`).toBeGreaterThanOrEqual(44)
        expect(sizes.get('md'), `${name} ${axis} from md up`).toBeGreaterThanOrEqual(24)
      }
    }
  })

  it('draws the icons in a grey that meets 3:1, never neutral-300 or -400', () => {
    withNativeShare()
    renderButtons()
    for (const control of controls()) {
      expect(
        [...control.classList].filter(c => /^text-neutral-[1-4]00$/.test(c)),
        control.getAttribute('aria-label')!,
      ).toEqual([])
    }
  })
})

describe('ShareButtons copy link', () => {
  const copyButton = () => screen.getByRole('button', { name: 'Copy link' })

  it('has an empty status region before any press, so the first result is announced', () => {
    renderButtons()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('copies the story address and says so', async () => {
    const writeText = withClipboard(() => Promise.resolve())
    renderButtons()
    fireEvent.click(copyButton())
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied!'))
    expect(writeText).toHaveBeenCalledWith(STORY_URL)
  })

  // A screen reader announces the status only when its text changes, so a repeat must change it too
  it('empties the status before showing "Copied!" again on a second press', async () => {
    withClipboard(() => Promise.resolve())
    renderButtons()
    const status = screen.getByRole('status')
    fireEvent.click(copyButton())
    await waitFor(() => expect(status.textContent).toBe('Copied!'))
    fireEvent.click(copyButton())
    await waitFor(() => expect(status.textContent).toBe(''))
    await waitFor(() => expect(status.textContent).toBe('Copied!'))
  })

  it('says so when the browser refuses to copy', async () => {
    withClipboard(() => Promise.reject(new Error('NotAllowedError')))
    renderButtons()
    fireEvent.click(copyButton())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not copy/i))
  })

  it('says so when the browser has no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderButtons()
    fireEvent.click(copyButton())
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not copy/i))
  })
})

describe('ShareButtons prefill', () => {
  it('says that the blurb is an AI summary in the X post text', () => {
    renderButtons()
    const href = screen.getByRole('link', { name: 'Share on X' }).getAttribute('href')!
    expect(new URL(href).searchParams.get('text')).toBe(PREFILL)
  })

  it('says it in the email body too', () => {
    renderButtons()
    const href = screen.getByRole('link', { name: 'Share via email' }).getAttribute('href')!
    expect(decodeURIComponent(href.split('body=')[1]!)).toBe(`${PREFILL}\n\n${STORY_URL}`)
  })

  it('says it in the native share text', () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    renderButtons()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(share).toHaveBeenCalledWith({ title: 'AI headline', text: PREFILL, url: STORY_URL })
  })
})
