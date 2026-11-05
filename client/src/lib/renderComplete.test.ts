import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PRERENDER_WAIT_ATTR, ROUTE_FALLBACK_ATTR, isPrerendering, signalRenderComplete } from './renderComplete'

const options = { initialDelayMs: 100, pollMs: 50, maxWaitMs: 1000 }

describe('isPrerendering', () => {
  it('is true only in an automated browser such as the prerenderer', () => {
    expect(isPrerendering({ webdriver: true })).toBe(true)
    expect(isPrerendering({ webdriver: false })).toBe(false)
    expect(isPrerendering()).toBe(false) // jsdom is not automated
  })
})

describe('signalRenderComplete', () => {
  let fired: number
  const onComplete = () => {
    fired += 1
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fired = 0
    document.body.innerHTML = ''
    document.addEventListener('render-complete', onComplete)
  })

  afterEach(() => {
    document.removeEventListener('render-complete', onComplete)
    vi.useRealTimers()
  })

  function addFallback(): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute(ROUTE_FALLBACK_ATTR, '')
    document.body.appendChild(el)
    return el
  }

  it('fires after the initial delay when no route fallback is showing', () => {
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(99)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
  })

  it('waits while a lazy page chunk is still loading, then gives the page the initial delay to settle before it fires', () => {
    const fallback = addFallback()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(300)
    expect(fired).toBe(0)
    fallback.remove()
    vi.advanceTimersByTime(50 + 99)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(1)
  })

  it('settles after a wait even when the content marker came and went between two checks', () => {
    // The chunk arrives, the page marks its wait, its data arrives and the marker goes, all within one poll:
    // no check ever sees the marker, but the head Helmet writes next still needs the settle
    const fallback = addFallback()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(100)
    const wait = addContentWait()
    fallback.remove()
    wait.remove()
    vi.advanceTimersByTime(50)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(99)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
  })

  it('fires anyway once the maximum wait has passed, so prerendering never hangs', () => {
    addFallback()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(999)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(51 + 100)
    expect(fired).toBe(1)
  })

  function addContentWait(): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute(PRERENDER_WAIT_ATTR, '')
    document.body.appendChild(el)
    return el
  }

  it('waits while a page waits for its content, then gives its head the initial delay to settle before it fires', () => {
    const wait = addContentWait()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(400)
    expect(fired).toBe(0)
    wait.remove()
    vi.advanceTimersByTime(50)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(99)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(1)
    expect(fired).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(1)
  })

  it('stops waiting for content once the maximum wait has passed', () => {
    addContentWait()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(999)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(51 + 100)
    expect(fired).toBe(1)
  })
})
