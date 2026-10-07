import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSavedCount } from './useSavedCount'
import { toggleSaved } from '../lib/preferences'

const SAVED_STORIES_KEY = 'ar-saved-stories'

describe('useSavedCount', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is 0 when nothing is saved', () => {
    const { result } = renderHook(() => useSavedCount())
    expect(result.current).toBe(0)
  })

  it('reads the stories already saved in this browser', () => {
    localStorage.setItem(SAVED_STORIES_KEY, JSON.stringify(['a', 'b']))
    const { result } = renderHook(() => useSavedCount())
    expect(result.current).toBe(2)
  })

  it('follows saving the first story and removing the last one, without a remount', () => {
    const { result } = renderHook(() => useSavedCount())

    act(() => {
      toggleSaved('first-story')
    })
    expect(result.current).toBe(1)

    act(() => {
      toggleSaved('first-story')
    })
    expect(result.current).toBe(0)
  })

  it('follows changes made in another tab', () => {
    const { result } = renderHook(() => useSavedCount())

    act(() => {
      localStorage.setItem(SAVED_STORIES_KEY, JSON.stringify(['from-other-tab']))
      window.dispatchEvent(new StorageEvent('storage', { key: SAVED_STORIES_KEY }))
    })
    expect(result.current).toBe(1)
  })
})
