import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PublicPodcastEpisode } from '@shared/types'
import AiBadge from '../ai/AiBadge'
import EpisodeStoryList from './EpisodeStoryList'
import { formatEpisodeDate, formatEpisodeDuration, podcastTranscriptPath } from '../../lib/podcast'

const ACTION_CLASS =
  'inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-800 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 rounded'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/**
 * The episode's secondary area: one quiet row of actions ("Stories (n)" and "Transcript"),
 * where Stories discloses the story list inline below the row and Transcript opens the episode's
 * transcript page. Collapsed by default; the list stays in the DOM (`hidden`) so the toggle's
 * `aria-controls` always resolves.
 */
function EpisodeDetails({ episode }: { episode: PublicPodcastEpisode }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const hasStories = episode.stories.length > 0

  return (
    <div className="mt-3 text-sm">
      <div data-episode-actions className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {hasStories && (
          <>
            <button
              type="button"
              className={ACTION_CLASS}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen(o => !o)}
            >
              Stories ({episode.stories.length})
              <ChevronIcon open={open} />
            </button>
            <span aria-hidden="true" className="text-neutral-400">·</span>
          </>
        )}
        <Link to={podcastTranscriptPath(episode.id)} className={ACTION_CLASS}>Transcript</Link>
      </div>
      {hasStories && <EpisodeStoryList stories={episode.stories} id={listId} hidden={!open} />}
    </div>
  )
}

/**
 * One published episode on /podcast: "AI" badge and title, date and duration, summary, player,
 * then the secondary details. The per-episode AI line is not repeated here: the page subtitle and
 * the badge before each title disclose it (the feed keeps the line, .context/ai-transparency.md).
 */
export default function PodcastEpisode({ episode }: { episode: PublicPodcastEpisode }) {
  const headingId = `episode-${episode.id}`
  const duration = formatEpisodeDuration(episode.durationSec)
  return (
    <article aria-labelledby={headingId} className="border-t border-neutral-200 pt-6">
      <h3 id={headingId} className="text-xl font-semibold text-neutral-900">
        {/* Inline, not flex: a wrapped title flows back under the badge instead of indenting */}
        <AiBadge className="mr-1 align-middle" />{' '}
        {episode.title}
      </h3>
      <p className="mt-1 text-sm text-neutral-600">
        <time dateTime={episode.publishedAt}>{formatEpisodeDate(episode.publishedAt)}</time>
        {duration && <> · {duration}</>}
      </p>
      <p className="mt-2 text-neutral-700">{episode.summary}</p>
      <audio controls preload="none" src={episode.audioUrl} className="mt-4 w-full" aria-label={`Play episode: ${episode.title}`} />
      <EpisodeDetails episode={episode} />
    </article>
  )
}
