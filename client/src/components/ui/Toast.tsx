import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

export type ToastType = 'success' | 'error' | 'progress'

interface Toast {
  id: string
  type: ToastType
  message: string
  /** In-app path the message links to (rendered as a router link). */
  href?: string
  /**
   * Shown after a progress toast's message but kept out of the live region, so a fast-changing
   * count (e.g. voiced chunks) does not re-announce the toast; a change of `message` is announced.
   */
  detail?: string
}

export interface ToastUpdate {
  type?: ToastType
  message?: string
  href?: string
  /** An outcome that stays until dismissed instead of disappearing after a few seconds. */
  sticky?: boolean
}

interface ToastContextValue {
  toast: (type: 'success' | 'error', message: string) => void
  /** A toast that stays while work runs (never auto-dismissed); same id updates it in place. */
  addProgressToast: (id: string, message: string, opts?: { href?: string; detail?: string }) => void
  updateToast: (id: string, updates: ToastUpdate) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let nextId = 0

const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-green-50 text-green-800 border border-green-200',
  error: 'bg-red-50 text-red-800 border border-red-200',
  progress: 'bg-blue-50 text-blue-800 border border-blue-200',
}

function ToastIcon({ type }: { type: ToastType }) {
  if (type === 'success') return <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0" aria-hidden="true" />
  if (type === 'error') return <ExclamationCircleIcon className="h-5 w-5 text-red-500 shrink-0" aria-hidden="true" />
  return <ArrowPathIcon className="h-5 w-5 text-blue-500 shrink-0 animate-spin" aria-hidden="true" />
}

/** The message, then the detail hidden from assistive technology (so its changes go unannounced). */
function ToastText({ toast }: { toast: Toast }) {
  return (
    <>
      {toast.message}
      {toast.detail && <span aria-hidden="true">{toast.detail}</span>}
    </>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(timer => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const clearTimer = useCallback((id: string) => {
    const existing = timersRef.current.get(id)
    if (existing) clearTimeout(existing)
    timersRef.current.delete(id)
  }, [])

  const startAutoDismiss = useCallback((id: string) => {
    clearTimer(id)
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      timersRef.current.delete(id)
    }, 4000)
    timersRef.current.set(id, timer)
  }, [clearTimer])

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = `auto-${nextId++}`
    setToasts(prev => [...prev, { id, type, message }])
    startAutoDismiss(id)
  }, [startAutoDismiss])

  const addProgressToast = useCallback((id: string, message: string, opts: { href?: string; detail?: string } = {}) => {
    clearTimer(id)
    setToasts(prev => {
      if (prev.some(t => t.id === id)) {
        return prev.map(t => t.id === id ? { ...t, type: 'progress' as const, message, detail: opts.detail, href: opts.href ?? t.href } : t)
      }
      return [...prev, { id, type: 'progress' as const, message, detail: opts.detail, href: opts.href }]
    })
  }, [clearTimer])

  const updateToast = useCallback((id: string, { sticky, ...updates }: ToastUpdate) => {
    setToasts(prev => prev.map(t => {
      if (t.id !== id) return t
      const updated = { ...t, ...updates }
      // An outcome is announced whole: a progress detail does not carry over into it.
      return updates.type && updates.type !== 'progress' ? { ...updated, detail: undefined } : updated
    }))
    if (updates.type && updates.type !== 'progress') {
      if (sticky) clearTimer(id)
      else startAutoDismiss(id)
    }
  }, [startAutoDismiss, clearTimer])

  const removeToast = useCallback((id: string) => {
    clearTimer(id)
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [clearTimer])

  return (
    <ToastContext.Provider value={{ toast: addToast, addProgressToast, updateToast, removeToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg text-sm font-medium ${TOAST_STYLES[t.type]}`}
          >
            <ToastIcon type={t.type} />
            {t.href ? (
              <Link
                to={t.href}
                // The link's name keeps the detail the live region leaves out.
                aria-label={t.detail ? `${t.message}${t.detail}` : undefined}
                className="underline underline-offset-2 hover:no-underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <ToastText toast={t} />
              </Link>
            ) : (
              <span><ToastText toast={t} /></span>
            )}
            <button
              onClick={() => removeToast(t.id)}
              className="ml-2 shrink-0 p-1 rounded text-current opacity-50 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:opacity-100"
              aria-label="Dismiss"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
