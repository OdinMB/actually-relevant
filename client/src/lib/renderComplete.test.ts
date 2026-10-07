import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ROUTE_FALLBACK_ATTR, signalRenderComplete } from './renderComplete'

const options = { initialDelayMs: 100, pollMs: 50, maxWaitMs: 1000 }

describe('signalRenderComplete', () => {
  let fired: number
  const onComplete = () => { fired += 1 }

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

  it('waits while a lazy page chunk is still loading, then fires once it is gone', () => {
    const fallback = addFallback()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(300)
    expect(fired).toBe(0)
    fallback.remove()
    vi.advanceTimersByTime(50)
    expect(fired).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(fired).toBe(1)
  })

  it('fires anyway once the maximum wait has passed, so prerendering never hangs', () => {
    addFallback()
    signalRenderComplete(document, options)
    vi.advanceTimersByTime(999)
    expect(fired).toBe(0)
    vi.advanceTimersByTime(51)
    expect(fired).toBe(1)
  })
})
