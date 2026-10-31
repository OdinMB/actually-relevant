import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { NEWSLETTER_FEED_URL } from '../lib/api'
import { loadStateOf } from '../lib/loadState'

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

const LINK_CLASS = 'text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/** A link inside a sentence is underlined: its color alone barely stands out from the text around it. */
const INLINE_LINK_CLASS = `${LINK_CLASS} underline`

/** Every published issue, newest first, paginated. Loads client-side (the prerenderer does not wait for data). */
function IssueList({ onPageChange }: { onPageChange: () => void }) {
  const [page, setPage] = useState(1)
  const archiveQuery = useNewsletterArchive(page)
  const { data } = archiveQuery
  const loadState = loadStateOf(archiveQuery)

  if (loadState === 'loading') return <NewsletterArchiveSkeleton />
  if (loadState !== 'ready') return <LoadFailure title="The past issues couldn't load" headingLevel={3} query={archiveQuery} className="py-8" />
  if (!data || data.data.length === 0) return <p className="text-neutral-600">No issues have been published yet.</p>
  return (
    <>
      <ul className="divide-y divide-neutral-100">
        {data.data.map(issue => (
          <li key={issue.slug} className="py-5">
            <Link to={`/newsletter/${issue.slug}`} className={`text-xl font-bold ${LINK_CLASS}`}>
              {issue.title}
            </Link>
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
          onPageChange()
        }}
      />
    </>
  )
}

/**
 * `/newsletter`, laid out like the podcast page: heading and AI subtitle, the signup form, then
 * every published issue. The heading, subtitle and form are static, so they prerender; the
 * issue list loads client-side. `/newsletter/archive` redirects here (App.tsx).
 */
export default function NewsletterPage() {
  const issuesRef = useRef<HTMLElement>(null)

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
        {CommonOgTags({})}
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
          <h2 id="newsletter-issues-heading" className="section-heading mb-2">
            Past issues
          </h2>
          <IssueList onPageChange={() => issuesRef.current?.scrollIntoView?.({ block: 'start' })} />
        </section>

        <PodcastCrossLink className="mt-10 border-t border-neutral-200 pt-6" />
      </div>
    </>
  )
}
