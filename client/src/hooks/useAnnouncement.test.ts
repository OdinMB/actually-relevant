import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ANNOUNCEMENT_CLEAR_MS, useAnnouncement } from './useAnnouncement'

describe('useAnnouncement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the announced text for a few seconds, then empties the region again', () => {
    const { result } = renderHook(() => useAnnouncement())
    expect(result.current.text).toBe('')

    act(() => result.current.announce('Page 2 of 3'))
    expect(result.current.text).toBe('Page 2 of 3')

    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS - 1))
    expect(result.current.text).toBe('Page 2 of 3')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.text).toBe('')
  })

  it('keeps a newer text for its own few seconds', () => {
    const { result } = renderHook(() => useAnnouncement())
    act(() => result.current.announce('First'))
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS - 100))

    act(() => result.current.announce('Second'))
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS - 1))
    expect(result.current.text).toBe('Second')
  })

  it('empties the region at once on clear, and nothing comes back later', () => {
    const { result } = renderHook(() => useAnnouncement())
    act(() => result.current.announce('Page B'))

    act(() => result.current.clear())
    expect(result.current.text).toBe('')
    act(() => vi.advanceTimersByTime(ANNOUNCEMENT_CLEAR_MS))
    expect(result.current.text).toBe('')
  })

  it('leaves no timer running after unmount', () => {
    const { result, unmount } = renderHook(() => useAnnouncement())
    act(() => result.current.announce('Page B'))

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
