import type { ReactNode } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'

interface ModalDialogProps {
  open: boolean
  onClose: () => void
  /**
   * The dialog's accessible name, kept whatever the content shows: a form's heading goes away
   * when its thank-you replaces it. Use the form's heading text.
   */
  title: string
  children: ReactNode
}

/**
 * The public site's modal dialog, around the signup and feedback forms: a native <dialog> that
 * opens and closes with `open`, asks `onClose` on Escape, a click on the backdrop or its Close
 * button, gives focus back to what opened it, and is named by `title` in every state.
 *
 * The content mounts only while the dialog is open. Every page holds these dialogs and the forms
 * fetch a form token when they mount, so each open starts a fresh form and a closed dialog
 * requests nothing.
 */
export default function ModalDialog({ open, onClose, title, children }: ModalDialogProps) {
  const dialogProps = useModalDialog(open, onClose)

  return (
    <dialog
      {...dialogProps}
      // The content fills the box, so a click that lands on the <dialog> itself is on the backdrop.
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 m-auto w-full max-w-md rounded-xl bg-white p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      aria-label={title}
    >
      <div className="p-6 sm:p-8">
        {open && children}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-neutral-500 hover:text-neutral-700 transition-colors rounded focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </dialog>
  )
}
