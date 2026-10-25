interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const SWEEP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

export interface TTLCacheOptions {
  /** At most this many entries; setting a new key at capacity drops the expired ones, then the oldest set. */
  maxEntries?: number
}

/**
 * The server's one in-memory cache: entries expire `ttlMs` after they are set (swept every 10
 * minutes and checked on read), optionally capped in size, and `cached()` coalesces concurrent
 * misses for a key into one load. Per process: a deploy starts it empty.
 */
export class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>()
  /** Loads in flight through `cached()`, so concurrent misses for a key share one. */
  private inflight = new Map<string, Promise<T>>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly maxEntries: number

  constructor(
    private readonly ttlMs: number,
    options: TTLCacheOptions = {},
  ) {
    this.maxEntries = options.maxEntries ?? Infinity
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
      this.sweepTimer.unref()
    }
  }

  get size(): number {
    return this.store.size
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    // Re-insert, so insertion order is the order of the last set (the eviction order)
    this.store.delete(key)
    if (this.store.size >= this.maxEntries) {
      this.sweep()
      for (const oldest of this.store.keys()) {
        if (this.store.size < this.maxEntries) break
        this.store.delete(oldest)
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  /** Drop the key, and let a load in flight for it finish without storing its result. */
  invalidate(key: string): void {
    this.store.delete(key)
    this.inflight.delete(key)
  }

  /** Drop every entry whose value (or key) matches; returns how many went. */
  invalidateWhere(match: (value: T, key: string) => boolean): number {
    let removed = 0
    for (const [key, entry] of this.store) {
      if (match(entry.value, key)) {
        this.store.delete(key)
        removed++
      }
    }
    return removed
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
  }

  /** Remove all expired entries. Called automatically every 10 minutes. */
  sweep(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key)
        removed++
      }
    }
    return removed
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    this.clear()
  }

  /** @see cached */
  load(key: string, fn: () => Promise<T>, shouldCache: (value: T) => boolean = () => true): Promise<T> {
    const hit = this.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = fn().then(
      value => {
        // Store only if nobody invalidated the key meanwhile
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key)
          if (shouldCache(value)) this.set(key, value)
        }
        return value
      },
      err => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key)
        throw err
      },
    )
    this.inflight.set(key, promise)
    return promise
  }
}

/**
 * Wrap an async function with caching. Concurrent misses for the same key share one call of `fn`;
 * a rejection is not cached. `shouldCache` can keep a result from being stored (it is still returned).
 */
export function cached<T>(cache: TTLCache<T>, key: string, fn: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T> {
  return cache.load(key, fn, shouldCache)
}
