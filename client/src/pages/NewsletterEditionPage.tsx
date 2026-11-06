import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { NewsletterEdition } from '@shared/types'
import { BRAND } from '../config'
import { ApiError, publicApi } from '../lib/api'
import { isPrerendering } from '../lib/renderComplete'
import { useSubscribe } from '../components/SubscribeProvider'

const PRIMARY_BUTTON =
  'inline-block px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed'
const HOME_LINK = 'text-brand-700 hover:text-brand-800 font-normal focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1'

/** What the page says about each edition it can switch to; the heading repeats the footer link's words. */
const EDITIONS: Record<NewsletterEdition, { heading: string; button: string; offer: string; done: string }> = {
  uplifting: {
    heading: `Get ${BRAND.upliftingEdition} instead?`,
    button: `Switch to ${BRAND.upliftingEdition}`,
    offer: `${BRAND.upliftingEdition} is the weekly newsletter with only the uplifting stories from Actually Relevant.`,
    done: `You'll get ${BRAND.upliftingEdition} from the next issue.`,
  },
  full: {
    heading: 'Get the full picture instead?',
    button: 'Switch to the full picture',
    offer: "The full Actually Relevant newsletter covers the week's news that matters to humanity, uplifting or not.",
    done: "You'll get the full picture from the next issue.",
  },
}

const other = (edition: NewsletterEdition): NewsletterEdition => (edition === 'uplifting' ? 'full' : 'uplifting')

/** The server's refusals (server/src/services/editionSwitch.ts), as the reader is told them. */
const REFUSALS: Record<string, string> = {
  closed: "Switching editions isn't available right now. You keep getting the newsletter you have.",
  broken_link: "This link is broken, and we've been told. The link in your next issue will work.",
  unknown_contact: "We couldn't find a subscription for this link. Subscribe again to choose your edition.",
  not_subscribed: "This address isn't subscribed anymore, so there's nothing to switch. Subscribe again to choose your edition.",
}

/** Refusals after which a new signup is the reader's way on. */
const SUBSCRIBE_AGAIN = new Set(['unknown_contact', 'not_subscribed'])

const GENERIC_ERROR = 'Something went wrong. Please try again.'

type SwitchState = { status: 'idle' | 'switching' } | { status: 'switched'; edition: NewsletterEdition } | { status: 'refused'; code: string }

function parseEdition(raw: string | null): NewsletterEdition | null {
  return raw === 'uplifting' || raw === 'full' ? raw : null
}

/**
 * `/newsletter-edition`, which each issue's footer switch link opens (`?c=<contact id>&to=<edition>`).
 * It switches only when the reader clicks its button, never on load, so a link scanner that runs
 * JavaScript switches nobody (owner decision, 2026-11-06); after a switch, "Switch back" undoes it.
 * Never indexed and out of the sitemap; the prerender, which has no link, shows a neutral loading line.
 */
export default function NewsletterEditionPage() {
  const [searchParams] = useSearchParams()
  const contactId = searchParams.get('c')?.trim() ?? ''
  const offered = parseEdition(searchParams.get('to'))
  const { openSubscribe } = useSubscribe()

  // The edition the button switches to: the link's at first, the other one after a switch
  const [target, setTarget] = useState<NewsletterEdition | null>(offered)
  const [state, setState] = useState<SwitchState>({ status: 'idle' })
  const [error, setError] = useState('')
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)

  // A switch replaces the focused button; focus moves to the heading that says it is done, so a
  // screen reader announces it. Loading the page moves no focus.
  useEffect(() => {
    if (state.status === 'switched') doneHeadingRef.current?.focus()
  }, [state])

  const handleSwitch = async (edition: NewsletterEdition) => {
    setTarget(edition)
    setState({ status: 'switching' })
    setError('')
    try {
      await publicApi.switchEdition({ contactId, edition })
      setState({ status: 'switched', edition })
    } catch (err) {
      if (err instanceof ApiError && err.code && REFUSALS[err.code]) {
        setState({ status: 'refused', code: err.code })
        return
      }
      // A network failure or a rate limit: keep the button, so the reader can try again
      setState({ status: 'idle' })
      setError(GENERIC_ERROR)
    }
  }

  const head = (
    <Helmet>
      <title>Switch Newsletter Edition - Actually Relevant</title>
      <meta name="description" content="Switch between the Actually Relevant and Actually Uplifting editions of the weekly newsletter." />
      {/* Never indexed: the link carries a reader's contact id */}
      <meta name="robots" content="noindex" />
    </Helmet>
  )

  if (!contactId || !target) {
    return (
      <>
        {head}
        <div className="page-section text-center py-16">
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">Switch your newsletter edition</h1>
          <p className="text-neutral-600 mb-6 max-w-md mx-auto">
            {isPrerendering()
              ? "One moment while this page loads. If it doesn't change, open the link in your newsletter again."
              : 'To switch editions, open the link at the end of any issue of the newsletter.'}
          </p>
          <Link to="/" className={HOME_LINK}>
            &larr; Back to home
          </Link>
        </div>
      </>
    )
  }

  if (state.status === 'switched') {
    const back = other(state.edition)
    return (
      <>
        {head}
        <div className="page-section text-center py-16">
          <h1 ref={doneHeadingRef} tabIndex={-1} className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4 focus:outline-none">
            {EDITIONS[state.edition].done}
          </h1>
          <p className="text-neutral-600 mb-8 max-w-md mx-auto">Changed your mind? You can switch back now, or with the link at the end of any issue.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <button type="button" onClick={() => handleSwitch(back)} className={PRIMARY_BUTTON}>
              Switch back
            </button>
            <Link to="/" className={HOME_LINK}>
              &larr; Back to home
            </Link>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {head}
      <div className="page-section text-center py-16">
        <h1 className="text-2xl md:text-3xl font-bold text-neutral-900 mb-4">{EDITIONS[target].heading}</h1>
        <p className="text-neutral-600 mb-8 max-w-md mx-auto">{EDITIONS[target].offer} No new confirmation is needed.</p>
        {state.status === 'refused' ? (
          <div role="alert">
            <p className="text-neutral-800 mb-6 max-w-md mx-auto">{REFUSALS[state.code]}</p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
              {SUBSCRIBE_AGAIN.has(state.code) && (
                <button type="button" onClick={() => openSubscribe()} className={PRIMARY_BUTTON}>
                  Subscribe again
                </button>
              )}
              <Link to="/" className={HOME_LINK}>
                &larr; Back to home
              </Link>
            </div>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => handleSwitch(target)} disabled={state.status === 'switching'} className={PRIMARY_BUTTON}>
              {state.status === 'switching' ? 'Switching...' : EDITIONS[target].button}
            </button>
            {error && (
              <p className="mt-4 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}
