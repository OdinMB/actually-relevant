import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile site key (build env `VITE_TURNSTILE_SITE_KEY`). Empty in local
 * development: no widget renders, and the API skips the check outside production.
 * Read here rather than in `config.ts`, which `vite.config.ts` imports in Node.
 */
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileRenderOptions {
  sitekey: string
  size: 'normal' | 'flexible' | 'compact'
  theme: 'light' | 'dark' | 'auto'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

/** Inject Cloudflare's script once per page; later callers share the same load. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile)
        else reject(new Error('Turnstile did not initialize'))
      }
      script.onerror = () => {
        scriptPromise = null // let a later mount try again
        script.remove()
        reject(new Error('Turnstile script failed to load'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

interface TurnstileWidgetProps {
  siteKey: string
  /** A fresh token, or `null` once it expired or the widget failed. */
  onToken: (token: string | null) => void
  /** The script or the widget could not load. */
  onError: () => void
}

/** Embeds Cloudflare's Turnstile check and reports its token. */
export default function TurnstileWidget({ siteKey, onToken, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onToken, onError })
  useEffect(() => {
    callbacks.current = { onToken, onError }
  })

  useEffect(() => {
    let cancelled = false
    let widgetId: string | null = null

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return
        widgetId = api.render(containerRef.current, {
          sitekey: siteKey,
          size: 'flexible',
          theme: 'light',
          callback: (token) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null)
            callbacks.current.onError()
          },
        })
      })
      .catch(() => {
        if (!cancelled) callbacks.current.onError()
      })

    return () => {
      cancelled = true
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [siteKey])

  // Reserved height keeps the submit button from jumping when the widget appears.
  return <div ref={containerRef} className="min-h-[65px]" />
}
