import { Link } from 'react-router-dom'
import { useSubscribe } from './SubscribeProvider'
import { FOCUS_RING, TEXT_LINK } from '../lib/control-classes'
import { PODCAST_SUBSCRIBE_PATH } from '../lib/podcast'
import { NewsletterIcon, PodcastIcon } from '../layouts/public/icons'

/*
 * The newsletter and the podcast are the site's two weekly products. The pages of each end with a
 * one-line offer of the other, and every story page with a button for each, after the main content
 * (.context/public-website.md, "Cross-links").
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

/** An outlined button with an icon, 44px tall on every screen (WCAG 2.5.8 and a comfortable tap). */
const STORY_PRODUCT_BUTTON = `inline-flex items-center justify-center gap-2 min-h-11 rounded-md border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-400 hover:bg-neutral-50 ${FOCUS_RING}`

/**
 * At the end of each story page: the two weekly products side by side, centered. "Newsletter"
 * opens the subscribe dialog, which returns focus to it on close; "Podcast" leads to the podcast
 * page's Subscribe section.
 */
export function StoryProductButtons({ className = '' }: { className?: string }) {
  const { openSubscribe } = useSubscribe()
  return (
    <div className={`flex flex-wrap justify-center gap-3 ${className}`}>
      <button type="button" onClick={() => openSubscribe()} className={STORY_PRODUCT_BUTTON}>
        <NewsletterIcon className="h-4 w-4 shrink-0 text-brand-700" />
        Newsletter
      </button>
      <Link to={PODCAST_SUBSCRIBE_PATH} className={STORY_PRODUCT_BUTTON}>
        <PodcastIcon className="h-4 w-4 shrink-0 text-brand-700" />
        Podcast
      </Link>
    </div>
  )
}
