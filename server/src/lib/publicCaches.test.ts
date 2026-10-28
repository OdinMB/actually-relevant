import { describe, it, expect, afterEach } from 'vitest'
import { TTLCache } from './cache.js'
import { BoundedCache } from './boundedCache.js'
import { registerPublicCache, clearPublicCaches } from './publicCaches.js'

describe('clearPublicCaches', () => {
  const ttl = new TTLCache<string>(60_000)
  const bounded = new BoundedCache<string>(10, 60_000)

  afterEach(() => ttl.destroy())

  it('empties every registered cache and reports how many entries each held', () => {
    registerPublicCache('ttl', ttl)
    registerPublicCache('bounded', bounded)
    ttl.set('a', '1')
    ttl.set('b', '2')
    bounded.set('c', '3')

    const cleared = clearPublicCaches()

    expect(cleared).toEqual(
      expect.arrayContaining([
        { name: 'ttl', entries: 2 },
        { name: 'bounded', entries: 1 },
      ]),
    )
    expect(ttl.get('a')).toBeUndefined()
    expect(bounded.get('c')).toBeUndefined()
  })
})
