import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { whenPageSettles } from './pageSettled'

const FRAME_MS = 16

describe('whenPageSettles', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls back a frame after the page was found idle on two checks in a row', () => {
    const onSettled = vi.fn()
    whenPageSettles(onSettled, { isBusy: () => false, pollMs: 100 })

    vi.advanceTimersByTime(99)
    expect(onSettled).not.toHaveBeenCalled()
    // The second idle check asks for a frame, so a title written in the next frame is in place
    vi.advanceTimersByTime(1)
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FRAME_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('waits while the page is busy, then for one more quiet check', () => {
    let busy = true
    const onSettled = vi.fn()
    whenPageSettles(onSettled, { isBusy: () => busy, pollMs: 100 })

    vi.advanceTimersByTime(1000)
    expect(onSettled).not.toHaveBeenCalled()

    busy = false
    vi.advanceTimersByTime(100 + FRAME_MS)
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('starts the quiet checks over when the page turns busy in between', () => {
    const states = [false, true, false, false]
    const onSettled = vi.fn()
    whenPageSettles(onSettled, { isBusy: () => states.shift() ?? false, pollMs: 100 })

    vi.advanceTimersByTime(200 + FRAME_MS)
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('calls back after maxWaitMs even while the page is still busy', () => {
    const onSettled = vi.fn()
    whenPageSettles(onSettled, { isBusy: () => true, pollMs: 100, maxWaitMs: 500 })

    vi.advanceTimersByTime(490)
    expect(onSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10 + FRAME_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('never calls back once cancelled, also after it asked for the frame', () => {
    const early = vi.fn()
    whenPageSettles(early, { isBusy: () => false, pollMs: 100 })()
    const late = vi.fn()
    const cancelLate = whenPageSettles(late, { isBusy: () => false, pollMs: 100 })
    vi.advanceTimersByTime(100)
    cancelLate()

    vi.advanceTimersByTime(1000)
    expect(early).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
  })
})
