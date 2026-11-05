import { useCallback, useEffect, useRef, useState } from 'react'

/** How long an announcement stays in its live region before the region is emptied again. */
export const ANNOUNCEMENT_CLEAR_MS = 5000

/**
 * The text of an always-present polite live region (`role="status"`): an in-app page change, the
 * page of a list a reader turned to. `announce` puts a text in; it stays for a few seconds, long
 * enough to be handed to a screen reader, and the region is then emptied, so a reader who moves
 * through the page later does not come across an old message. `clear` empties it at once. A
 * caller that may announce the same text twice clears first, in an earlier render, so the text
 * changes and is read again.
 */
export function useAnnouncement() {
  const [text, setText] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const clear = useCallback(() => {
    clearTimeout(timer.current)
    setText('')
  }, [])

  const announce = useCallback((next: string) => {
    clearTimeout(timer.current)
    setText(next)
    timer.current = setTimeout(() => setText(''), ANNOUNCEMENT_CLEAR_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { text, announce, clear }
}
