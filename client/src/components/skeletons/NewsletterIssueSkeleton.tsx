import { ISSUE_CARD_CLASS, ISSUE_PAGE_CLASS } from '../../lib/newsletter-issue'

/**
 * Skeleton placeholder for a newsletter issue's web edition.
 * Matches the card, masthead, strip, title, date, AI label, section heading and story blocks to prevent CLS.
 */
export default function NewsletterIssueSkeleton() {
  return (
    <div className={ISSUE_PAGE_CLASS} aria-hidden="true">
      <div className={`${ISSUE_CARD_CLASS} animate-pulse`}>
        <div className="hidden sm:block">
          <div className="px-10 pt-10">
            <div className="mx-auto h-16 w-40 rounded bg-neutral-200" />
            <div className="mx-auto mt-1 h-5 w-52 rounded bg-neutral-100" />
          </div>
          <div className="mt-5 h-1 bg-neutral-200" />
        </div>
        <div className="px-5 pt-8 sm:px-10 sm:pt-6">
          <div className="mx-auto h-6 w-48 rounded bg-neutral-300 md:h-7" />
          <div className="mx-auto mt-1 h-5 w-32 rounded bg-neutral-200" />
          <div className="mx-auto mt-4 h-10 w-full max-w-md rounded bg-neutral-100" />
        </div>
        <div className="px-5 pt-2 pb-10 sm:px-10">
          <div className="mx-auto mt-12 mb-1 h-5 w-56 rounded bg-neutral-200" />
          {[1, 2, 3].map(i => (
            <div key={i} className="mt-8">
              <div className="mb-1.5 h-3 w-24 rounded bg-neutral-200" />
              <div className="mb-3 h-7 w-4/5 rounded bg-neutral-300" />
              <div className="mb-4 h-4 w-56 rounded bg-neutral-200" />
              <div className="mb-2 h-4 w-full rounded bg-neutral-100" />
              <div className="h-4 w-5/6 rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
