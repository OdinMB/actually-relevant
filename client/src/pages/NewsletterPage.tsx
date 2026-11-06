import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import { formatEpisodeDate } from '../lib/podcast'
import StructuredData from '../components/StructuredData'
import SubscribeForm from '../components/SubscribeForm'
import Pagination from '../components/Pagination'
import { PodcastCrossLink } from '../components/CrossLinks'
import AiSubtitle from '../components/ai/AiSubtitle'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { NewsletterArchiveSkeleton } from '../components/skeletons'
import LoadFailure from '../components/LoadFailure'
import { useNewsletterArchive } from '../hooks/useNewsletterArchive'
import { usePageTurn } from '../hooks/usePageTurn'
import { NEWSLETTER_FEED_URL, sectionOgImage } from '../lib/api'
import { FOCUS_RING } from '../lib/control-classes'
import { loadStateOf } from '../lib/loadState'
import { ARCHIVE_FILTER_PARAM, archiveEdition, archiveFilterOf, withArchiveFilter, type ArchiveFilter } from '../lib/newsletterArchiveFilter'
import { useUpliftingEdition } from '../contexts/PositivityContext'
import NewsletterEditionTag from '../components/NewsletterEditionTag'
import { BRAND } from '../config'

const META = {
  title: 'Newsletter - Actually Relevant',
  description:
    'Subscribe to the Actually Relevant weekly newsletter, or read past issues on the web. The stories that matter to humanity, curated by AI and delivered to your inbox every week.',
  url: `${SEO.siteUrl}/newsletter`,
}

const breadcrumb = buildBreadcrumbSchema([
  { name: 'Home', url: SEO.siteUrl },
  { name: 'Newsletter', url: META.url },
])

const LINK_CLASS = `text-brand-700 hover:text-brand-800 ${FOCUS_RING} rounded px-0.5`

/** A link inside a sentence is underlined: its color alone barely stands out from the text around it. */
const INLINE_LINK_CLASS = `${LINK_CLASS} underline`

const FILTER_OPTIONS: { value: ArchiveFilter; label: string }[] = [
  { value: 'all', label: 'All issues' },
  { value: 'uplifting', label: BRAND.upliftingEdition },
]

/** The archive's two-option filter: toggle buttons, the pressed one the list shown. */
function ArchiveFilterButtons({ filter, onChange }: { filter: ArchiveFilter; onChange: (filter: ArchiveFilter) => void }) {
  return (
    <div role="group" aria-label="Show issues" className="mb-2 flex flex-wrap gap-2">
      {FILTER_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => onChange(value)}
          className={`min-h-6 rounded-full border px-3 py-1.5 text-sm transition-colors ${FOCUS_RING} ${
            filter === value ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The published issues `filter` names, newest first, paginated. Loads client-side (never asked for while
 * prerendering, so no dated list is baked in). Another page moves focus to the section's `heading` and is announced once it is in.
 */
function IssueList({ filter, heading, onPageChange }: { filter: ArchiveFilter; heading: RefObject<HTMLHeadingElement | null>; onPageChange: () => void }) {
  const [page, setPage] = useState(1)
  const archiveQuery = useNewsletterArchive(page, archiveEdition(filter))
  const { data } = archiveQuery
  const loadState = loadStateOf(archiveQuery)
  const pageTurn = usePageTurn({ heading, page, totalPages: data?.totalPages ?? 1, settled: loadState === 'ready' && !archiveQuery.isPlaceholderData })

  return (
    <>
      {/* Always on the page, whatever the list shows, so the page a reader turned to is announced */}
      <p role="status" className="sr-only">
        {pageTurn.announcement}
      </p>
      {issueList()}
    </>
  )

  function issueList(): ReactNode {
    if (loadState === 'loading') return <NewsletterArchiveSkeleton />
    if (loadState !== 'ready') return <LoadFailure title="The past issues couldn't load" headingLevel={3} query={archiveQuery} className="py-8" />
    if (!data || data.data.length === 0)
      return (
        <p className="text-neutral-600">
          {filter === 'uplifting' ? `No ${BRAND.upliftingEdition} issues have been published yet.` : 'No issues have been published yet.'}
        </p>
      )
    return (
      <>
        <ul className="divide-y divide-neutral-100">
          {data.data.map(issue => (
            <li key={issue.slug} className="py-5">
              <NewsletterEditionTag edition={issue.edition} className="mb-1" />
              <div>
                <Link to={`/newsletter/${issue.slug}`} className={`text-xl font-bold ${LINK_CLASS}`}>
                  {issue.title}
                </Link>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                <time dateTime={issue.publishedAt}>{formatEpisodeDate(issue.publishedAt)}</time>
                {issue.storyCount > 0 && (
                  <>
                    {' '}
                    · {issue.storyCount} {issue.storyCount === 1 ? 'story' : 'stories'}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onPageChange={next => {
            setPage(next)
            pageTurn.turned(next)
            onPageChange()
          }}
        />
      </>
    )
  }
}

/**
 * `/newsletter`, laid out like the podcast page: heading and AI subtitle, the signup form, then
 * the published issues of both editions, filterable to Actually Uplifting (`?edition=`, opening on
 * that filter inside the edition). The heading, subtitle, form and filter are static, so they
 * prerender (as the All view: the prerender is never inside the edition); the issue list loads
 * client-side. `/newsletter/archive` redirects here (App.tsx).
 */
export default function NewsletterPage() {
  const issuesRef = useRef<HTMLElement>(null)
  const issuesHeadingRef = useRef<HTMLHeadingElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = archiveFilterOf(searchParams.get(ARCHIVE_FILTER_PARAM), useUpliftingEdition())

  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <link rel="canonical" href={META.url} />
        <link rel="alternate" type="application/rss+xml" title="Actually Relevant newsletter" href={NEWSLETTER_FEED_URL} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags(sectionOgImage('newsletter'))}
      </Helmet>
      <StructuredData data={breadcrumb} />

      <div className="page-section py-16">
        <h1 className="page-title">Newsletter</h1>
        <AiSubtitle copy={AI_DISCLOSURE_COPY.newsletterSubtitle} />

        <section aria-labelledby="newsletter-subscribe-heading" className="mt-10">
          <h2 id="newsletter-subscribe-heading" className="section-heading mb-4">
            Subscribe
          </h2>
          <div className="max-w-md">
            <SubscribeForm hideHeading idPrefix="newsletter-page" />
            <p className="mt-3 text-sm text-neutral-600">
              Prefer a feed reader?{' '}
              <a href={NEWSLETTER_FEED_URL} className={INLINE_LINK_CLASS}>
                Follow new issues by RSS
              </a>
              .
            </p>
          </div>
        </section>

        <section ref={issuesRef} aria-labelledby="newsletter-issues-heading" className="mt-10">
          {/* Focus comes here when the reader picks another page of issues; a heading is not a control, so no outline */}
          <h2 ref={issuesHeadingRef} id="newsletter-issues-heading" className="section-heading mb-2 focus:outline-none">
            Past issues
          </h2>
          <ArchiveFilterButtons
            filter={filter}
            onChange={next => setSearchParams(prev => withArchiveFilter(prev, next), { replace: true, preventScrollReset: true })}
          />
          {/* Keyed by the filter, so another filter starts on its first page */}
          <IssueList key={filter} filter={filter} heading={issuesHeadingRef} onPageChange={() => issuesRef.current?.scrollIntoView?.({ block: 'start' })} />
        </section>

        <PodcastCrossLink className="mt-10 border-t border-neutral-200 pt-6" />
      </div>
    </>
  )
}
