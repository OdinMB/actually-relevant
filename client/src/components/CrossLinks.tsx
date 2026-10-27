import { Link } from 'react-router-dom'
import { useSubscribe } from './SubscribeProvider'
import { TEXT_LINK } from '../lib/control-classes'
import type { LatestNewsletterIssue } from '../hooks/useNewsletterArchive'

/*
 * The newsletter and the podcast are the site's two weekly products. The pages of each end with a
 * one-line offer of the other, and every story page with one of the newsletter, after the main
 * content (.context/public-website.md, "Cross-links").
 */

/** On /newsletter and each issue page: the podcast. */
export function PodcastCrossLink({ className = '' }: { className?: string }) {
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Prefer to listen?{' '}
      <Link to="/podcast" className={TEXT_LINK}>
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
      <button type="button" onClick={() => openSubscribe()} className={TEXT_LINK}>
        Get the weekly newsletter
      </button>{' '}
      by email, or{' '}
      <Link to="/newsletter" className={TEXT_LINK}>
        read past issues
      </Link>{' '}
      on the web.
    </p>
  )
}

/** A 24px box (WCAG 2.5.8) that still sits on the sentence's baseline. */
const LINE_TARGET_CLASS = `inline-flex items-center min-h-6 ${TEXT_LINK}`

/**
 * At the end of each story page: the newsletter, in the subscribe dialog, and in the same sentence
 * the newest issue's web edition (`useLatestNewsletterIssue`, which the page asks for when it
 * mounts); without one the sentence ends at the button. The dialog returns focus to the button on
 * close.
 */
export function StoryNewsletterLine({ latestIssue, className = '' }: { latestIssue: LatestNewsletterIssue | null; className?: string }) {
  const { openSubscribe } = useSubscribe()
  return (
    <p className={`text-sm text-neutral-600 ${className}`}>
      Get stories like this once a week.{' '}
      <button type="button" onClick={() => openSubscribe()} className={LINE_TARGET_CLASS}>
        Subscribe to the newsletter
      </button>
      {latestIssue && (
        <>
          , or{' '}
          <Link to={`/newsletter/${latestIssue.slug}`} className={LINE_TARGET_CLASS}>
            {latestIssue.thisWeek ? 'read this week’s issue' : 'read the latest issue'}
          </Link>
        </>
      )}
    </p>
  )
}
