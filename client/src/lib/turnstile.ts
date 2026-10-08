/**
 * Cloudflare Turnstile, fetched and run only on demand. Nothing reaches Cloudflare until
 * `runTurnstileChallenge` is called, which the signup form does only on submit, so
 * visitors who never sign up never contact Cloudflare. No npm dependency.
 */

/**
 * Site key (build env `VITE_TURNSTILE_SITE_KEY`). Empty in local development: no
 * challenge runs, and the API skips the check outside production. Read here rather
 * than in `config.ts`, which `vite.config.ts` imports in Node.
 */
export function turnstileSiteKey(): string {
  return import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileRenderOptions {
  sitekey: string
  /** Render without running; the challenge starts at `execute()`. */
  execution: 'execute'
  /** Invisible unless Cloudflare needs the visitor to interact. */
  appearance: 'interaction-only'
  /** A failure is final for this challenge; the visitor retries by submitting again. */
  retry: 'never'
  size: 'flexible'
  theme: 'light'
  callback: (token: string) => void
  'error-callback': () => void
  'timeout-callback': () => void
  'unsupported-callback': () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  execute: (container: HTMLElement) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

/** Inject Cloudflare's script once per page; concurrent callers share one load, and a failed load can be retried. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_URL
      script.async = true
      const fail = (message: string) => {
        scriptPromise = null
        script.remove()
        reject(new Error(message))
      }
      script.onload = () => {
        if (!window.turnstile) return fail('Turnstile did not initialize')
        scriptPromise = null // window.turnstile answers later calls
        resolve(window.turnstile)
      }
      script.onerror = () => fail('Turnstile script failed to load')
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export interface TurnstileChallenge {
  /** A single-use token, or a rejection if the script, the challenge or the browser failed. */
  token: Promise<string>
  /** Stop waiting: removes the widget and rejects `token`. No-op once settled. */
  cancel: () => void
}

/**
 * Upper bound on one challenge, script load included. Cloudflare's own timeout covers only
 * an unsolved interactive challenge, not a stalled script or a widget that never answers.
 */
export const TURNSTILE_TIMEOUT_MS = 30_000

/**
 * Load Turnstile if needed, render a widget into `container` and run its challenge once.
 * The token always settles: with a token, or a rejection on any failure, the time limit
 * or `cancel`. The widget is removed as soon as it settles, since its token is single-use.
 */
export function runTurnstileChallenge(container: HTMLElement, siteKey: string): TurnstileChallenge {
  let settled = false
  let widgetId: string | null = null
  let api: TurnstileApi | null = null
  let resolveToken: (value: string) => void = () => {}
  let rejectToken: (err: Error) => void = () => {}
  const token = new Promise<string>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })

  /** Settle once: clear the time limit, remove the widget, then resolve or reject. */
  const finish = (outcome: { token: string } | { error: Error }) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (api && widgetId !== null) api.remove(widgetId)
    if ('token' in outcome) resolveToken(outcome.token)
    else rejectToken(outcome.error)
  }
  const fail = (message: string) => finish({ error: new Error(message) })
  const timer = setTimeout(() => fail('Turnstile challenge timed out'), TURNSTILE_TIMEOUT_MS)

  loadTurnstile().then(
    (loaded) => {
      if (settled) return
      api = loaded
      try {
        widgetId = loaded.render(container, {
          sitekey: siteKey,
          execution: 'execute',
          appearance: 'interaction-only',
          retry: 'never',
          size: 'flexible',
          theme: 'light',
          callback: (value) => finish({ token: value }),
          'error-callback': () => fail('Turnstile challenge failed'),
          'timeout-callback': () => fail('Turnstile challenge timed out'),
          'unsupported-callback': () => fail('Turnstile is not supported in this browser'),
        })
        if (settled) loaded.remove(widgetId) // a callback fired during render
        else loaded.execute(container)
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Turnstile could not render')
      }
    },
    (err: Error) => finish({ error: err }),
  )

  return { token, cancel: () => fail('Turnstile challenge cancelled') }
}
