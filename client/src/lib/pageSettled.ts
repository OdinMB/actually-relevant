export interface SettleOptions {
  /** True while the page is still loading (a page chunk, its data). */
  isBusy: () => boolean
  /** How often to look. */
  pollMs?: number
  /** Gives up waiting after this long and calls back anyway. */
  maxWaitMs?: number
}

/**
 * Calls `onSettled` once the page has finished loading: `isBusy()` false on two checks in a row,
 * `pollMs` apart (a query that resolves re-renders its page a moment later), or `maxWaitMs` after
 * the first check whatever it says. The call comes one animation frame later, since
 * react-helmet-async writes the page's title in a frame of its own. Returns a cancel function.
 */
export function whenPageSettles(onSettled: () => void, { isBusy, pollMs = 100, maxWaitMs = 5000 }: SettleOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  let waitedMs = 0
  let idleBefore = false

  const check = () => {
    const idle = !isBusy()
    if ((idle && idleBefore) || waitedMs >= maxWaitMs) {
      frame = requestAnimationFrame(() => onSettled())
      return
    }
    idleBefore = idle
    waitedMs += pollMs
    timer = setTimeout(check, pollMs)
  }
  check()

  return () => {
    clearTimeout(timer)
    if (frame !== undefined) cancelAnimationFrame(frame)
  }
}
