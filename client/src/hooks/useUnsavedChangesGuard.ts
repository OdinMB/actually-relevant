import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import type { BlockerFunction } from 'react-router-dom'

/**
 * Location state for a navigation that already discards the unsaved edits (e.g. after deleting the
 * episode): `navigate(path, { state: LEAVE_UNSAVED })` passes the guard without asking.
 */
export const LEAVE_UNSAVED = { leaveUnsaved: true } as const

function leavesUnsaved(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { leaveUnsaved?: unknown }).leaveUnsaved === true
}

/**
 * Asks before unsaved edits are thrown away. `guard(action)` runs the action at once when nothing
 * is unsaved, otherwise holds it until `confirm()`. While edits are unsaved, any in-app navigation
 * to another path is held the same way through react-router's `useBlocker`: link clicks,
 * `navigate()` calls and the browser's Back/Forward. A change of the search alone on the same path
 * passes (it is the page's own URL state, such as `?tab=`; tab switches go through `guard`), as does
 * a navigation carrying `LEAVE_UNSAVED`. Closing or reloading the tab asks through the browser's own
 * `beforeunload` prompt. `asking`, `confirm` and `cancel` drive one dialog for both kinds of hold
 * (`UnsavedChangesDialog`). A page uses one guard; `markSaved` lets it leave right after a save.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const [pending, setPending] = useState<(() => void) | null>(null)

  // Read when a navigation is checked, so `markSaved` takes effect before the next render.
  const dirtyRef = useRef(dirty)
  useLayoutEffect(() => { dirtyRef.current = dirty })

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && currentLocation.pathname !== nextLocation.pathname && !leavesUnsaved(nextLocation.state),
    [],
  )
  const blocker = useBlocker(shouldBlock)

  /**
   * The edits were just saved: a navigation in the same tick (e.g. back to the list after Save)
   * leaves without asking, though the form has not re-rendered as clean yet. The next render
   * guards by `dirty` again.
   */
  const markSaved = useCallback(() => { dirtyRef.current = false }, [])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const guard = useCallback((action: () => void) => {
    if (dirty) setPending(() => action)
    else action()
  }, [dirty])

  const confirm = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.proceed()
      return
    }
    const action = pending
    setPending(null)
    action?.()
  }, [blocker, pending])

  const cancel = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset()
    setPending(null)
  }, [blocker])

  return { guard, asking: pending !== null || blocker.state === 'blocked', confirm, cancel, markSaved }
}
