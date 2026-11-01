import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { publicApi, ApiError } from '../lib/api'
import { BRAND, NEWSLETTER_PROMISE } from '../config'
import { FORM_TOKEN_MIN_AGE_MS, FORM_TOKEN_POST_MAX_AGE_MS, FORM_TOKEN_REFRESH_MS } from '../lib/formToken'
import { turnstileSiteKey } from '../lib/turnstile'
import { isPrerendering } from '../lib/renderComplete'
import { useTurnstileChallenge } from '../hooks/useTurnstileChallenge'

interface SubscribeFormProps {
  /** Called after successful submission (e.g. to close a modal) */
  onSuccess?: () => void
  /** Auto-focus the email input on mount */
  autoFocus?: boolean
  /** ID prefix for form elements (avoids collisions when rendered multiple times) */
  idPrefix?: string
  /** Hide the heading and tagline (when the parent provides its own) */
  hideHeading?: boolean
  /**
   * Shows a "Read past issues" link to /newsletter under the form, and is called when it is
   * followed (e.g. to close a modal). Leave it out on /newsletter, which lists the issues itself.
   */
  onPastIssuesClick?: () => void
}

/**
 * Whether the API takes signups: it answers the token request with SIGNUPS_PAUSED when not.
 * `unavailable`: both token attempts failed, so the form cannot be sent.
 */
type Availability = 'checking' | 'open' | 'paused' | 'unavailable'

type SubmitStatus = 'idle' | 'verifying' | 'loading' | 'success' | 'error'

/** Why the form token could not be fetched, which decides the line shown under the form. */
type UnavailableReason = 'unreachable' | 'rate-limited'

const UNAVAILABLE_NOTES: Record<UnavailableReason, string> = {
  unreachable: "The signup form can't load right now. Please reload the page or try again later.",
  // The token route has only the public API's request limits, not the signup limits.
  'rate-limited': "Too many requests from this network right now, so the signup form can't load. Please try again in a few minutes.",
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'
// Told by the status alone: the signup POST sits behind the public API's request limit, shared with
// the other public routes, as well as its own per-minute and daily limits, so the line names none of them.
const RATE_LIMIT_ERROR = 'Too many requests from this network right now. Please try again in a few minutes, or tomorrow if this keeps happening.'

function isSignupsPaused(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SIGNUPS_PAUSED'
}

function isRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429
}

function submitLabel(status: SubmitStatus, availability: Availability): string {
  if (status === 'verifying') return 'Verifying...'
  if (status === 'loading') return 'Subscribing...'
  return availability === 'checking' ? 'Loading...' : 'Subscribe'
}

/** A plausible address: something@domain.suffix, no spaces. The server validates fully. */
function isPlausibleEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
}

/** The anti-bot form token the form holds, with the times (`Date.now()`) that decide when it may be posted. */
interface HeldToken {
  value: string
  receivedAt: number
  /**
   * From when the server takes it. The first token may be posted at once: its age is how long
   * the form has been open, which is what the server's minimum fill time measures. A
   * replacement's age says nothing about the reader, so it waits out that minimum.
   */
  postableFrom: number
}

/** Asks for a form token, trying twice. A paused answer is final; otherwise the last error is thrown. */
async function fetchFormToken(): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { token } = await publicApi.getSubscribeToken()
      return token
    } catch (err) {
      if (isSignupsPaused(err)) throw err
      lastError = err
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function SubscribeForm({ onSuccess, autoFocus = false, idPrefix = 'subscribe', hideHeading = false, onPastIssuesClick }: SubscribeFormProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot — humans never fill this
  // Never rendered, so a ref: `availability` turns 'open' when the first token arrives.
  const tokenRef = useRef<HeldToken | null>(null)
  const replacementRef = useRef<Promise<HeldToken> | null>(null)
  const [availability, setAvailability] = useState<Availability>('checking')
  const [unavailableReason, setUnavailableReason] = useState<UnavailableReason>('unreachable')
  // Turnstile loads only on submit, so visitors who never sign up never contact Cloudflare.
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const { containerRef: turnstileContainerRef, getToken: getTurnstileToken } = useTurnstileChallenge()
  const emailInputRef = useRef<HTMLInputElement>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => emailInputRef.current?.focus())
    }
  }, [autoFocus])

  // "Check your email" replaces the form and its focused Subscribe button; focus moves to its
  // heading so a screen reader announces it, and keyboard focus stays where the form was.
  useEffect(() => {
    if (status === 'success') successHeadingRef.current?.focus()
  }, [status])

  // Fetch the anti-bot form token on mount; its answer also says whether signups are open.
  // If both attempts fail, submit stays disabled (the API is unreachable anyway) and the
  // reader is told.
  useEffect(() => {
    let cancelled = false
    fetchFormToken().then(
      value => {
        if (cancelled) return
        const now = Date.now()
        tokenRef.current = { value, receivedAt: now, postableFrom: now }
        setAvailability('open')
      },
      err => {
        if (cancelled) return
        if (isSignupsPaused(err)) setAvailability('paused')
        // Not while prerendering: the build's API may be unreachable, and the message would be
        // baked into every page's static HTML.
        else if (!isPrerendering()) {
          setUnavailableReason(isRateLimited(err) ? 'rate-limited' : 'unreachable')
          setAvailability('unavailable')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  /** Fetches a token to replace the one held, joining a fetch already under way. */
  const replaceToken = useCallback((): Promise<HeldToken> => {
    if (!replacementRef.current) {
      replacementRef.current = fetchFormToken()
        .then(value => {
          const receivedAt = Date.now()
          const token = { value, receivedAt, postableFrom: receivedAt + FORM_TOKEN_MIN_AGE_MS }
          tokenRef.current = token
          return token
        })
        .finally(() => {
          replacementRef.current = null
        })
    }
    return replacementRef.current
  }, [])

  // Timers stop in a background tab, so the moment a reader comes back to the page is when an
  // ageing token is replaced: the new one is then old enough by the time they submit.
  useEffect(() => {
    function replaceIfAgeing() {
      const token = tokenRef.current
      if (document.visibilityState !== 'visible' || !token) return
      if (Date.now() - token.receivedAt < FORM_TOKEN_REFRESH_MS) return
      // On failure the held token stays, and the submit tries again.
      replaceToken().catch(() => {})
    }
    document.addEventListener('visibilitychange', replaceIfAgeing)
    window.addEventListener('focus', replaceIfAgeing)
    return () => {
      document.removeEventListener('visibilitychange', replaceIfAgeing)
      window.removeEventListener('focus', replaceIfAgeing)
    }
  }, [replaceToken])

  /** The token to post: replaced first when it is too old for the server, and given once it is old enough. */
  async function postableToken(): Promise<string> {
    let token = tokenRef.current
    if (!token || Date.now() - token.receivedAt > FORM_TOKEN_POST_MAX_AGE_MS) token = await replaceToken()
    const wait = token.postableFrom - Date.now()
    if (wait > 0) await sleep(wait)
    return token.value
  }

  const siteKey = turnstileSiteKey()
  const busy = status === 'verifying' || status === 'loading'
  const canSubmit = !busy && availability === 'open'
  // Notes under the form: centered under its own heading (the modal), left-aligned in a parent's column (/newsletter).
  const noteAlign = hideHeading ? 'text-left' : 'text-center'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const address = email.trim()
    if (!canSubmit) return
    if (!isPlausibleEmail(address)) {
      setTurnstileFailed(false)
      setStatus('error')
      setErrorMessage('Please enter a valid email address.')
      return
    }

    setErrorMessage('')
    setTurnstileFailed(false)
    // A token is single-use, so every submit runs a fresh challenge.
    let turnstileToken: string | undefined
    if (siteKey) {
      setStatus('verifying')
      try {
        turnstileToken = await getTurnstileToken(siteKey)
      } catch {
        setStatus('idle')
        setTurnstileFailed(true)
        return
      }
    }

    setStatus('loading')
    try {
      // A token the server would drop still gets a success reply, and no email would come.
      const formToken = await postableToken()
      const result = await publicApi.subscribe({
        email: address,
        ...(website ? { website } : {}),
        formToken,
        ...(turnstileToken ? { turnstileToken } : {}),
      })
      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.message || GENERIC_ERROR)
        return
      }
      setStatus('success')
    } catch (err) {
      if (isSignupsPaused(err)) {
        setAvailability('paused')
        return
      }
      setStatus('error')
      setErrorMessage(isRateLimited(err) ? RATE_LIMIT_ERROR : GENERIC_ERROR)
    }
  }

  if (availability === 'paused') {
    return (
      <div className="text-center py-4" role="status">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 id={`${idPrefix}-title`} className="text-xl font-bold text-neutral-900 mb-2">
          Signups are paused
        </h2>
        <p className="text-neutral-600 text-sm mb-6">
          New newsletter registrations are temporarily disabled. We expect to have them back up again soon — thanks for your patience.
        </p>
        {onSuccess && (
          <button
            onClick={onSuccess}
            className="px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Got it
          </button>
        )}
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="text-center py-4" role="status">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-50 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 ref={successHeadingRef} tabIndex={-1} className="text-xl font-bold text-neutral-900 mb-2 focus:outline-none">
          Check your email
        </h2>
        <p className="text-neutral-600 text-sm mb-3">
          A confirmation link is on its way to <strong>{email}</strong>. Click the link to start receiving our weekly newsletter.
        </p>
        <p className="text-neutral-600 text-sm mb-6">
          It usually arrives within minutes, but at busy times it can take a few hours. If you can't find it, please check your spam folder.
        </p>
        {onSuccess && (
          <button
            onClick={onSuccess}
            className="px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Done
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {!hideHeading && (
        <div className="text-center mb-6">
          <h2 id={`${idPrefix}-title`} className="text-xl font-bold text-neutral-900 mb-1">
            Stay informed
          </h2>
          <p className="text-neutral-500 text-sm">
            {BRAND.claim} Weekly to your inbox. {BRAND.claimSupport}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={`${idPrefix}-email`} className="sr-only">
            Email address
          </label>
          <input
            ref={emailInputRef}
            id={`${idPrefix}-email`}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="w-full px-4 py-3 text-base border border-neutral-300 rounded-lg bg-neutral-50 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none transition-colors"
            aria-describedby={[availability === 'unavailable' && `${idPrefix}-unavailable`, errorMessage && `${idPrefix}-error`, `${idPrefix}-promise`]
              .filter(Boolean)
              .join(' ')}
          />
        </div>

        {/* Honeypot — hidden from humans */}
        <div aria-hidden="true" className="absolute -left-[9999px] -top-[9999px]">
          <label htmlFor={`${idPrefix}-website`}>Website</label>
          <input id={`${idPrefix}-website`} type="text" value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
        </div>

        {/* Stays empty unless Cloudflare needs the visitor to interact during a submit. */}
        {siteKey && <div ref={turnstileContainerRef} className="empty:hidden" />}

        {turnstileFailed && (
          <p className="text-sm text-red-600" role="alert">
            The human check couldn't load. Please press Subscribe to try again.
          </p>
        )}

        {status === 'error' && (
          <p id={`${idPrefix}-error`} className="text-sm text-red-600" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-3 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitLabel(status, availability)}
        </button>
      </form>

      {/* Always mounted, so screen readers announce the message when it appears. */}
      <div role="status">
        {availability === 'unavailable' && (
          <p id={`${idPrefix}-unavailable`} className={`mt-4 ${noteAlign} text-sm text-neutral-700`}>
            {UNAVAILABLE_NOTES[unavailableReason]}
          </p>
        )}
      </div>
      <p id={`${idPrefix}-promise`} className={`mt-3 ${noteAlign} text-sm text-neutral-600`}>
        {NEWSLETTER_PROMISE}
      </p>
      {onPastIssuesClick && (
        <p className={`${noteAlign} text-sm`}>
          <Link
            to="/newsletter"
            onClick={onPastIssuesClick}
            className="inline-block py-1 text-brand-700 underline underline-offset-2 hover:text-brand-800 rounded px-0.5 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Read past issues
          </Link>
        </p>
      )}
    </>
  )
}
