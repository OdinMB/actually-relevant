import { useEffect, useRef, type ReactEventHandler } from 'react'

/**
 * Runs a native <dialog> as a modal that React state opens and closes: `showModal()` when `open`
 * turns true (the browser moves focus in and keeps it there), `close()` when it turns false, then
 * focus back to the element that had it before opening. Escape asks `onClose` instead of closing
 * the dialog behind React's back. Spread the returned props on the <dialog>.
 */
export function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
      // Browsers give focus back on close() themselves; this covers any that don't. An opener that
      // left the page (a link in the dialog changed the route) cannot take focus, so then this
      // does nothing.
      openerRef.current?.focus({ preventScroll: true })
      openerRef.current = null
    }
  }, [open])

  const onCancel: ReactEventHandler<HTMLDialogElement> = e => {
    e.preventDefault()
    onClose()
  }

  return { ref, onCancel }
}
