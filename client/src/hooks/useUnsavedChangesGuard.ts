import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** The in-app path an ordinary left click on this anchor would open, or null when the browser should handle it. */
export function internalLinkTarget(event: MouseEvent, origin: string): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null
  const url = new URL(anchor.href, origin)
  if (url.origin !== origin) return null
  return url.pathname + url.search + url.hash
}

/**
 * Asks before unsaved edits are thrown away. `guard(action)` runs the action at once when nothing
 * is unsaved, otherwise holds it until `confirm()`. While edits are unsaved, closing or reloading
 * the tab asks through the browser, and a click on an in-app link (sidebar, back link, toast) is
 * held the same way. The app uses `BrowserRouter`, where react-router's `useBlocker` is not
 * available, so the browser's own back button is not intercepted.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const here = location.pathname + location.search + location.hash

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    const onClick = (e: MouseEvent) => {
      const to = internalLinkTarget(e, window.location.origin)
      if (!to || to === here) return
      e.preventDefault()
      setPending(() => () => navigate(to))
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, here, navigate])

  const guard = useCallback((action: () => void) => {
    if (dirty) setPending(() => action)
    else action()
  }, [dirty])

  const confirm = useCallback(() => {
    const action = pending
    setPending(null)
    action?.()
  }, [pending])

  const cancel = useCallback(() => setPending(null), [])

  return { guard, asking: pending !== null, confirm, cancel }
}
