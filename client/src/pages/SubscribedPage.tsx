import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { BRAND } from '../config'
import { publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'

export default function SubscribedPage() {
  const [searchParams] = useSearchParams()
  const urlError = searchParams.get('error')
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  const [confirmState, setConfirmState] = useState<'idle' | 'confirming' | 'confirmed' | 'failed'>('idle')
  const [failReason, setFailReason] = useState<'expired' | 'invalid'>('invalid')
  const [confirmError, setConfirmError] = useState('')

  const handleConfirm = async () => {
    if (!token || !email) return
    setConfirmState('confirming')
    setConfirmError('')
    try {
      const res = await publicApi.confirmSubscription({ token, email })
      if (res.success) {
        setConfirmState('confirmed')
      } else {
        // Definitive server verdict (expired / invalid link).
        setFailReason(res.reason === 'expired' ? 'expired' : 'invalid')
        setConfirmState('failed')
      }
    } catch {
      // Transient/network error — keep the button so the user can retry rather
      // than dead-ending on a misleading "invalid link" page.
      setConfirmState('idle')
      setConfirmError('Something went wrong. Please try again.')
    }
  }

  // Never indexed, in any state: the token-carrying link must not be, and every address of the page
  // first serves the prerendered no-token view, whose head is the only one a crawler without JS sees.
  const robots = <meta name="robots" content="noindex" />

  // Error state: from the redirect (?error=) or a failed confirmation POST.
  const effectiveError = urlError === 'expired' || urlError === 'invalid' ? urlError : confirmState === 'failed' ? failReason : null

  if (effectiveError === 'expired') {
    return (
      <>
        <Helmet>
          <title>Link Expired - Actually Relevant</title>
          <meta name="description" content="Your confirmation link has expired." />
          {robots}
        </Helmet>
        <div className="page-section text-center py-16">
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">Link Expired</h1>
          <p className="text-neutral-600 mb-6">Your confirmation link has expired. Please subscribe again to receive a new link.</p>
          <Link to="/" className="text-brand-700 hover:text-brand-800 font-normal focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1">
            &larr; Back to home
          </Link>
        </div>
      </>
    )
  }

  if (effectiveError === 'invalid') {
    return (
      <>
        <Helmet>
          <title>Invalid Link - Actually Relevant</title>
          <meta name="description" content="Invalid confirmation link." />
          {robots}
        </Helmet>
        <div className="page-section text-center py-16">
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">Invalid Link</h1>
          <p className="text-neutral-600 mb-6">This confirmation link is invalid or has already been used.</p>
          <Link to="/" className="text-brand-700 hover:text-brand-800 font-normal focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1">
            &larr; Back to home
          </Link>
        </div>
      </>
    )
  }

  // Confirmation step: a real human click (POST) finalizes the subscription, so
  // email security scanners that prefetch the link can't auto-confirm. Without a
  // token and address there is nothing to confirm, so the view claims nothing. The
  // prerender renders it too: that HTML is what the confirmation link shows until
  // the script runs, so it says the page is loading rather than to open the link.
  if (confirmState !== 'confirmed') {
    return (
      <>
        <Helmet>
          <title>Confirm Your Subscription - Actually Relevant</title>
          <meta name="description" content="Confirm your Actually Relevant newsletter subscription." />
          {robots}
        </Helmet>
        <div className="page-section text-center py-16">
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">Confirm your subscription</h1>
          {token && email ? (
            <>
              <p className="text-neutral-600 mb-8 max-w-md mx-auto">You're one click away from the Actually Relevant weekly newsletter.</p>
              <button
                onClick={handleConfirm}
                disabled={confirmState === 'confirming'}
                className="inline-block px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {confirmState === 'confirming' ? 'Confirming...' : 'Confirm my subscription'}
              </button>
              {confirmError && (
                <p className="mt-4 text-sm text-red-600" role="alert">
                  {confirmError}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-neutral-600 mb-6 max-w-md mx-auto">
                {isPrerendering()
                  ? "One moment while this page loads. If it doesn't change, open the link in your confirmation email again."
                  : 'To finish subscribing to the weekly newsletter, open the link in your confirmation email.'}
              </p>
              <Link to="/" className="text-brand-700 hover:text-brand-800 font-normal focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1">
                &larr; Back to home
              </Link>
            </>
          )}
        </div>
      </>
    )
  }

  // Reached only after the confirm POST succeeded.
  return (
    <>
      <Helmet>
        <title>Welcome to the Newsletter - Actually Relevant</title>
        <meta name="description" content="You're subscribed to the Actually Relevant weekly newsletter." />
        {robots}
      </Helmet>
      <div className="page-section text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-brand-50 flex items-center justify-center">
          <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">Welcome to the newsletter!</h1>
        <p className="text-neutral-600 mb-4 max-w-md mx-auto">
          {BRAND.claim}
          <br className="sm:hidden" />
          Weekly to your inbox.
          <br />
          {BRAND.claimSupport}
        </p>
        <p className="text-neutral-600 mb-8 max-w-md mx-auto">Your subscription is confirmed. In the meantime, explore what's making headlines right now.</p>
        <Link
          to="/"
          className="inline-block px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Explore today's stories
        </Link>
      </div>
    </>
  )
}
