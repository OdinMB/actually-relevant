import { Link } from 'react-router-dom'
import { useSubscribe } from './SubscribeProvider'

/*
 * The newsletter and the podcast are the site's two weekly products. The pages of each end with a
 * one-line offer of the other, and every story page with one of the newsletter, after the main
 * content (.context/public-website.md, "Cross-links").
 */

const LINK_CLASS = 'text-brand-700 underline hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/** On /newsletter and each issue page: the podcast. */
export function PodcastCrossLink({ className = '' }: { className?: string }) {
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Prefer to listen?{' '}
      <Link to="/podcast" className={LINK_CLASS}>
        Try the weekly podcast
      </Link>
      , a five-minute briefing on the news that matters most.
    </p>
  )
}

/** On /podcast and each transcript page: the newsletter, signed up for in the site's subscribe dialog. */
export function NewsletterCrossLink({ className = '' }: { className?: string }) {
  const { openSubscribe } = useSubscribe()
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Prefer to read?{' '}
      <button type="button" onClick={() => openSubscribe()} className={LINK_CLASS}>
        Get the weekly newsletter
      </button>{' '}
      by email, or{' '}
      <Link to="/newsletter" className={LINK_CLASS}>
        read past issues
      </Link>{' '}
      on the web.
    </p>
  )
}

/**
 * At the end of each story page: the newsletter, in the subscribe dialog. The button is a 24px box
 * (WCAG 2.5.8) that still sits on the sentence's baseline; the dialog returns focus to it on close.
 */
export function StoryNewsletterLine({ className = '' }: { className?: string }) {
  const { openSubscribe } = useSubscribe()
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Get stories like this once a week.{' '}
      <button type="button" onClick={() => openSubscribe()} className={`inline-flex items-center min-h-6 ${LINK_CLASS}`}>
        Subscribe to the newsletter
      </button>
    </p>
  )
}
