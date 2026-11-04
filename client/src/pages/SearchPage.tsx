import { useState, useEffect, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { usePublicStories } from '../hooks/usePublicStories'
import { usePageTurn } from '../hooks/usePageTurn'
import StoryCard from '../components/StoryCard'
import Pagination from '../components/Pagination'
import { SearchResultsSkeleton } from '../components/skeletons'
import LoadFailure from '../components/LoadFailure'
import { isRateLimited } from '../lib/api'
import { FOCUS_RING } from '../lib/control-classes'
import { loadStateOf } from '../lib/loadState'
import { SEO, CommonOgTags } from '../lib/seo'

/** Searches have their own, tighter rate limit (the server's `searchLimiter`), and "Try again" passes only once its window moves on. */
const RATE_LIMIT_HINT = 'Too many searches from this network right now. Please try again in a few minutes.'

/**
 * The query's latest error, kept while "Try again" runs: TanStack Query clears `error` when a
 * query without data fetches again, and the failure's line must not change while the reader waits.
 */
function useLatestError(query: { error: unknown; isFetching: boolean }): unknown {
  const [latest, setLatest] = useState<unknown>(null)
  if (query.error != null && query.error !== latest) setLatest(query.error)
  return query.error ?? (query.isFetching ? latest : null)
}

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') || ''
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [q])

  const resultsQuery = usePublicStories({
    search: q || undefined,
    page,
    pageSize: 12,
  })
  const data = resultsQuery.data
  const loadState = loadStateOf(resultsQuery)
  const rateLimited = isRateLimited(useLatestError(resultsQuery))

  const stories = data?.data ?? []
  const totalPages = data?.totalPages ?? 1
  const headingRef = useRef<HTMLHeadingElement>(null)
  const pageTurn = usePageTurn({ heading: headingRef, page, totalPages, settled: loadState === 'ready' })

  return (
    <>
      <Helmet>
        <title>
          {q ? `Search: ${q}` : 'Search'} - {SEO.siteName}
        </title>
        <meta name="description" content={q ? `Search results for "${q}" on Actually Relevant` : 'Search stories on Actually Relevant'} />
        <meta property="og:title" content={q ? `Search: ${q} - ${SEO.siteName}` : `Search - ${SEO.siteName}`} />
        <meta property="og:type" content="website" />
        {CommonOgTags({})}
      </Helmet>

      <div className="page-section-wide">
        <header className="mb-6">
          {/* Focus comes here when the reader picks another page of results; a heading is not a control, so no outline */}
          <h1 ref={headingRef} className="text-xl md:text-2xl font-bold focus:outline-none">
            {q ? <>Search results for &ldquo;{q}&rdquo;</> : 'Search'}
          </h1>
          {q && loadState === 'ready' && <p className="text-sm text-neutral-500 mt-1">{data?.total === 1 ? '1 result' : `${data?.total ?? 0} results`}</p>}
        </header>
        <p role="status" className="sr-only">
          {pageTurn.announcement}
        </p>

        {!q ? (
          <p className="text-neutral-500 text-center py-8">Enter a search term to find stories.</p>
        ) : loadState === 'loading' ? (
          <SearchResultsSkeleton />
        ) : loadState !== 'ready' ? (
          <LoadFailure
            title="The search results couldn't load"
            headingLevel={2}
            hint={rateLimited ? RATE_LIMIT_HINT : undefined}
            query={resultsQuery}
            className="py-8"
          />
        ) : stories.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-neutral-500 mb-4">No results found for &ldquo;{q}&rdquo;.</p>
            <Link to="/" className={`text-brand-700 hover:text-brand-800 font-normal ${FOCUS_RING} rounded px-1`}>
              &larr; Back to home
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-3">
              {stories.map(story => (
                <StoryCard key={story.id} story={story} variant="equal" />
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={next => {
                setPage(next)
                pageTurn.turned(next)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          </>
        )}
      </div>
    </>
  )
}
