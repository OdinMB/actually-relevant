import { describe, it, expect, vi, afterEach } from 'vitest'
import { BoundedCache } from './boundedCache.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('BoundedCache', () => {
  it('drops the least recently used entry when full', () => {
    const cache = new BoundedCache<number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // a is now the most recent
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('expires entries after the TTL', () => {
    vi.useFakeTimers()
    const cache = new BoundedCache<string>(10, 1000)
    cache.set('k', 'v')
    vi.advanceTimersByTime(999)
    expect(cache.get('k')).toBe('v')
    vi.advanceTimersByTime(2)
    expect(cache.get('k')).toBeUndefined()
  })
})
