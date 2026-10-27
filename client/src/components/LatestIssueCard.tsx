import { Link } from 'react-router-dom'
import type { LatestNewsletterIssue } from '../hooks/useNewsletterArchive'
import { NewsletterIcon } from '../layouts/public/icons'

/**
 * On the home page: the newest newsletter issue's web edition, one link whose name is its visible
 * text. Full width on phones; from `md` up as wide as its text, up to the column. Two lines whatever
 * the title's length (the title truncates only once the column is full, the story count stays), so
 * it always fits the slot kept for it (HomePage).
 */
export default function LatestIssueCard({ issue }: { issue: LatestNewsletterIssue }) {
  return (
    <Link
      to={`/newsletter/${issue.slug}`}
      className="group flex w-full min-w-0 max-w-full md:w-auto items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <NewsletterIcon className="h-5 w-5 shrink-0 text-brand-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-wider text-neutral-500">
          {issue.thisWeek ? 'This week’s newsletter' : 'Latest newsletter'}
        </span>{' '}
        <span className="flex text-sm text-neutral-600">
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
  )
}
