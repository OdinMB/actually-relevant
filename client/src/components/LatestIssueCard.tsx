import { Link } from 'react-router-dom'
import type { LatestNewsletterIssue } from '../hooks/useNewsletterArchive'
import { NewsletterIcon } from '../layouts/public/icons'
import { useSubscribe } from './SubscribeProvider'

/**
 * On the home page: the newest newsletter issue's web edition, one link whose name is its visible
 * text, on two lines (label above title). Phones get that link alone, full width. From `md` up the
 * card starts right of the first section's illustration (which reaches up into the slot) and runs
 * to the column's edge, and beside the link sits a button that opens the signup. The title truncates only once its line is full and the story count stays, so the
 * card always fits the slot kept for it (HomePage).
 */
export default function LatestIssueCard({ issue }: { issue: LatestNewsletterIssue }) {
  const { openSubscribe } = useSubscribe()

  return (
    <div className="flex w-full min-w-0 max-w-full items-stretch rounded-lg border border-neutral-200 bg-white transition-colors hover:border-brand-300 md:ml-40">
      <Link
        to={`/newsletter/${issue.slug}`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2.5 md:gap-4 md:px-5 md:py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <NewsletterIcon className="h-5 w-5 shrink-0 text-brand-700" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
            {issue.thisWeek ? 'This week’s newsletter' : 'Latest newsletter'}
          </span>{' '}
          <span className="flex min-w-0 text-sm text-neutral-600">
            <span className="truncate font-bold text-neutral-900 group-hover:text-brand-800">{issue.title}</span>
            {issue.storyCount > 0 && (
              <span className="shrink-0 whitespace-pre">
                {' '}
                · {issue.storyCount} {issue.storyCount === 1 ? 'story' : 'stories'}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-brand-700" aria-hidden="true">
          &rarr;
        </span>
      </Link>
      <div className="hidden shrink-0 items-center border-l border-neutral-200 px-4 md:flex">
        <button
          type="button"
          onClick={() => openSubscribe()}
          className="rounded-md bg-neutral-800 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Get it by email
        </button>
      </div>
    </div>
  )
}
