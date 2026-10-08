import { useState, useRef, useEffect } from 'react'
import { publicApi, ApiError } from '../lib/api'
import { BRAND } from '../config'
import { turnstileSiteKey } from '../lib/turnstile'
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
}

/** Whether the API takes signups: it answers the token request with SIGNUPS_PAUSED when not. */
type Availability = 'checking' | 'open' | 'paused'

function isSignupsPaused(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SIGNUPS_PAUSED'
}

/** A plausible address: something@domain.suffix, no spaces. The server validates fully. */
function isPlausibleEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
}

export default function SubscribeForm({
  onSuccess,
  autoFocus = false,
  idPrefix = 'subscribe',
  hideHeading = false,
}: SubscribeFormProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot — humans never fill this
  const [formToken, setFormToken] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Availability>('checking')
  // Turnstile loads only on submit, so visitors who never sign up never contact Cloudflare.
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const { containerRef: turnstileContainerRef, getToken: getTurnstileToken } = useTurnstileChallenge()
  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      requestAnimationFrame(() => emailInputRef.current?.focus())
    }
  }, [autoFocus])

  // Fetch the anti-bot form token on mount; its answer also says whether signups are open.
  useEffect(() => {
    let cancelled = false
    async function loadToken() {
      // Try up to twice; if both fail, the token stays null and submit stays
      // disabled (the API is unreachable anyway). A paused answer is final.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { token } = await publicApi.getSubscribeToken()
          if (!cancelled) {
            setFormToken(token)
            setAvailability('open')
          }
          return
        } catch (err) {
          if (isSignupsPaused(err)) {
            if (!cancelled) setAvailability('paused')
            return
          }
        }
      }
    }
    loadToken()
    return () => {
      cancelled = true
    }
  }, [])

  const siteKey = turnstileSiteKey()
  const busy = status === 'verifying' || status === 'loading'
  const canSubmit = !busy && formToken !== null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const address = email.trim()
    if (!canSubmit || !formToken) return
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
      const result = await publicApi.subscribe({
        email: address,
        ...(website ? { website } : {}),
        formToken,
        ...(turnstileToken ? { turnstileToken } : {}),
      })
      if (!result.success) {
        setStatus('error')
        setErrorMessage(result.message || 'Something went wrong. Please try again.')
        return
      }
      setStatus('success')
    } catch (err) {
      if (isSignupsPaused(err)) {
        setAvailability('paused')
        return
      }
      setStatus('error')
      setErrorMessage('Something went wrong. Please try again.')
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
        <h2 id={`${idPrefix}-title`} className="text-xl font-bold text-neutral-900 mb-2">Signups are paused</h2>
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
        <h2 className="text-xl font-bold text-neutral-900 mb-2">Check your email</h2>
        <p className="text-neutral-600 text-sm mb-6">
          We sent a confirmation link to <strong>{email}</strong>. Click the link to start receiving our weekly newsletter.
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
          <label htmlFor={`${idPrefix}-email`} className="sr-only">Email address</label>
          <input
            ref={emailInputRef}
            id={`${idPrefix}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="w-full px-4 py-3 text-base border border-neutral-300 rounded-lg bg-neutral-50 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none transition-colors"
            aria-describedby={errorMessage ? `${idPrefix}-error` : undefined}
          />
        </div>

        {/* Honeypot — hidden from humans */}
        <div aria-hidden="true" className="absolute -left-[9999px] -top-[9999px]">
          <label htmlFor={`${idPrefix}-website`}>Website</label>
          <input
            id={`${idPrefix}-website`}
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Stays empty unless Cloudflare needs the visitor to interact during a submit. */}
        {siteKey && <div ref={turnstileContainerRef} className="empty:hidden" />}

        {turnstileFailed && (
          <p className="text-sm text-red-600" role="alert">
            The human check couldn't load. Please reload the page and try again.
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
          {status === 'verifying' ? 'Verifying...' : status === 'loading' ? 'Subscribing...' : 'Subscribe'}
        </button>
      </form>
    </>
  )
}
