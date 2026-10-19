import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import { formatEpisodeDate } from '../lib/podcast'
import StructuredData from '../components/StructuredData'
import Pagination from '../components/Pagination'
import { NewsletterArchiveSkeleton } from '../components/skeletons'
import { useNewsletterArchive } from '../hooks/useNewsletterArchive'

const META = {
  title: 'Newsletter Archive - Actually Relevant',
  description:
    'Read every past issue of the Actually Relevant weekly newsletter on the web: the stories that matter to humanity, one week at a time.',
  url: `${SEO.siteUrl}/newsletter/archive`,
}

const breadcrumb = buildBreadcrumbSchema([
  { name: 'Home', url: SEO.siteUrl },
  { name: 'Newsletter', url: `${SEO.siteUrl}/newsletter` },
  { name: 'Archive', url: META.url },
])

const LINK_CLASS = 'text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/** `/newsletter/archive`: every published issue, newest first. Prerendered; the list loads client-side. */
export default function NewsletterArchivePage() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError } = useNewsletterArchive(page)

  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <link rel="canonical" href={META.url} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData data={breadcrumb} />

      <div className="page-section py-16">
        <h1 className="page-title">Newsletter Archive</h1>
        <p className="page-intro">
          Every past issue of the weekly newsletter, to read on the web.{' '}
          <Link to="/newsletter" className={LINK_CLASS}>Subscribe</Link> to get the next one in your inbox.
        </p>

        <section aria-labelledby="archive-heading" className="mt-10">
          <h2 id="archive-heading" className="sr-only">Issues</h2>
          {isLoading ? (
            <NewsletterArchiveSkeleton />
          ) : isError ? (
            <p className="text-neutral-500 text-center">The archive could not be loaded. Please try again later.</p>
          ) : !data || data.data.length === 0 ? (
            <p className="text-neutral-500 text-center">No issues have been published yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-neutral-100">
                {data.data.map((issue) => (
                  <li key={issue.slug} className="py-5">
                    <Link to={`/newsletter/${issue.slug}`} className={`text-xl font-bold ${LINK_CLASS}`}>
                      {issue.title}
                    </Link>
                    <p className="mt-1 text-sm text-neutral-600">
                      <time dateTime={issue.publishedAt}>{formatEpisodeDate(issue.publishedAt)}</time>
                      {issue.storyCount > 0 && <> · {issue.storyCount} {issue.storyCount === 1 ? 'story' : 'stories'}</>}
                    </p>
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                totalPages={data.totalPages}
                onPageChange={(next) => {
                  setPage(next)
                  window.scrollTo({ top: 0 })
                }}
              />
            </>
          )}
        </section>
      </div>
    </>
  )
}
