import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PublicStoryAppearances } from '@shared/types'
import AiBadge from './ai/AiBadge'
import { NewsletterIcon, PodcastIcon } from '../layouts/public/icons'
import { FOCUS_RING } from '../lib/control-classes'
import { formatEpisodeDuration, podcastTranscriptPath } from '../lib/podcast'

/** One card: a single link whose name is its visible text, label above title, like the home page's newsletter card. */
function AppearanceCard({ to, icon, label, children }: { to: string; icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`group flex h-full items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 transition-colors hover:border-brand-300 ${FOCUS_RING}`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wider text-neutral-500">{label}</span>{' '}
        <span className="block text-sm text-neutral-600">{children}</span>
      </span>
      <span className="shrink-0 text-brand-700" aria-hidden="true">
        &rarr;
      </span>
    </Link>
  )
}

const ICON_CLASS = 'h-5 w-5 shrink-0 text-brand-700'
const TITLE_CLASS = 'font-bold text-neutral-900 group-hover:text-brand-800'

/**
 * At the end of a story page: the newsletter issue and the podcast episode the story appeared in,
 * a card each linking its page (`useStoryAppearances`). Nothing until the answer is there, and
 * nothing for a story in neither. The episode's title is AI text and carries the "AI" badge before
 * it, as on /podcast; the issue's title ("Week 43, 2026") is not.
 */
export default function StoryAppearances({ appearances, className = '' }: { appearances: PublicStoryAppearances | undefined; className?: string }) {
  const issue = appearances?.newsletterIssue
  const episode = appearances?.podcastEpisode
  if (!issue && !episode) return null
  const duration = episode ? formatEpisodeDuration(episode.durationSec) : null

  return (
    <ul className={`grid gap-3 ${issue && episode ? 'sm:grid-cols-2' : ''} ${className}`}>
      {issue && (
        <li>
          <AppearanceCard to={`/newsletter/${issue.slug}`} icon={<NewsletterIcon className={ICON_CLASS} />} label="Featured in the newsletter">
            <span className={TITLE_CLASS}>{issue.title}</span>
            {issue.storyCount > 0 && ` · ${issue.storyCount} ${issue.storyCount === 1 ? 'story' : 'stories'}`}
          </AppearanceCard>
        </li>
      )}
      {episode && (
        <li>
          <AppearanceCard to={podcastTranscriptPath(episode.id)} icon={<PodcastIcon className={ICON_CLASS} />} label="Featured on the podcast">
            {/* Inline, not flex: a wrapped title flows back under the badge instead of indenting */}
            <AiBadge className="mr-1 align-middle text-neutral-900" /> <span className={TITLE_CLASS}>{episode.title}</span>
            {duration && ` · ${duration}`}
          </AppearanceCard>
        </li>
      )}
    </ul>
  )
}
