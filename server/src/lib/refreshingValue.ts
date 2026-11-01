/**
 * One value kept warm in memory: rebuilt in the background on a timer and whenever a read finds it
 * older than `refreshMs`, while readers get the last good copy at once. Only the very first read
 * (or the first after `clear()`) waits for a load. A failed refresh keeps the copy it had and is
 * logged; a failed first load rejects, as an uncached load would. Concurrent loads share one call.
 *
 * Use it where serving a copy up to one interval old is fine and a visitor should never wait for
 * the database (the homepage, `.context/public-website.md`). Per process: a deploy starts it empty,
 * which `start()` covers by loading at once.
 */
import { createLogger } from './logger.js'
import type { ClearableCache } from './publicCaches.js'

const log = createLogger('cache')

export class RefreshingValue<T> implements ClearableCache {
  private current: { value: T; loadedAt: number } | undefined
  private inflight: Promise<T> | undefined
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly name: string,
    private readonly refreshMs: number,
    private readonly load: () => Promise<T>,
  ) {}

  get size(): number {
    return this.current ? 1 : 0
  }

  /** The last good copy, at once; starts a background refresh when it is older than `refreshMs`. */
  async get(): Promise<T> {
    if (!this.current) return this.loadShared()
    if (Date.now() - this.current.loadedAt >= this.refreshMs) void this.refresh()
    return this.current.value
  }

  /** Rebuild the value now; a failure is logged and the previous copy stays. Never rejects. */
  async refresh(): Promise<void> {
    try {
      await this.loadShared()
    } catch (err) {
      log.warn({ err, cache: this.name, servingCopyFrom: this.current?.loadedAt }, 'background refresh failed')
    }
  }

  /** Load now and then every `refreshMs`. The timer does not keep the process alive. */
  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.refreshMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Drop the copy (the admin "Clear cache" control); the next read waits for a fresh load. */
  clear(): void {
    this.current = undefined
    this.inflight = undefined
  }

  private loadShared(): Promise<T> {
    if (this.inflight) return this.inflight
    const promise = this.load().then(
      value => {
        // A clear() meanwhile disowns this load: its result is returned but not kept
        if (this.inflight === promise) {
          this.inflight = undefined
          this.current = { value, loadedAt: Date.now() }
        }
        return value
      },
      (err: unknown) => {
        if (this.inflight === promise) this.inflight = undefined
        throw err
      },
    )
    this.inflight = promise
    return promise
  }
}
