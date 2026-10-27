import type { ReactNode } from 'react'

/** The query whose load failed: what the message needs to retry it and to tell attempts apart. */
interface RetryableQuery {
  refetch: () => unknown
  isFetching: boolean
  /** When the latest attempt failed (TanStack Query's `errorUpdatedAt`). */
  errorUpdatedAt: number
}

interface LoadFailureProps {
  /** What did not load, as the heading: "This story couldn't load". */
  title: string
  /** 1 where the failure is the whole page; 2 for one part of a page that has its own h1. */
  headingLevel?: 1 | 2
  query: RetryableQuery
  className?: string
  /** Further ways on, after the button, such as a link back to the page's list. */
  children?: ReactNode
}

const LOAD_FAILURE_HINT = 'The connection may have dropped, or the site is busy right now. Please try again.'

/**
 * Shown when a public page's data fails to load for any reason but a 404 (`loadStateOf` in
 * lib/loadState.ts): says so in an alert, without moving focus, and offers "Try again", which asks
 * the query again in place. Each failed attempt inserts a new alert, so a failed retry is
 * announced too, while the button and its focus stay.
 */
export default function LoadFailure({ title, headingLevel = 1, query, className = '', children }: LoadFailureProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div className={`text-center ${className}`}>
      <div role="alert" key={query.errorUpdatedAt}>
        <Heading className={headingLevel === 1 ? 'page-title' : 'text-xl font-bold mb-2'}>{title}</Heading>
        <p className="text-neutral-600 mb-6">{LOAD_FAILURE_HINT}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-base font-normal text-white transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {query.isFetching ? 'Trying again...' : 'Try again'}
        </button>
        {children}
      </div>
    </div>
  )
}
