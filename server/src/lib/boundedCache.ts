/**
 * A small in-memory cache with a time-to-live and a maximum number of entries. When full,
 * the least recently used entry goes. For per-key caches that a crawler could otherwise
 * grow without bound (one entry per story), on a memory-capped instance; TTLCache in
 * cache.ts has no size limit.
 */
export class BoundedCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>()

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    // Re-insert so Map order is least recently used first
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    this.store.delete(key)
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string
      this.store.delete(oldest)
    }
  }

  get size(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }
}
