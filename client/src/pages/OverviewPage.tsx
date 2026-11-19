import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { PublicOverview } from '@shared/types'
import { SEO, CommonOgTags } from '../lib/seo'
import { sectionOgImage } from '../lib/api'
import { getCategoryColor } from '../lib/category-colors'
import { FOCUS_RING, TEXT_LINK } from '../lib/control-classes'
import { loadStateOf } from '../lib/loadState'
import { buildBreadcrumbSchema, buildOverviewSchema } from '../lib/structured-data'
import { usePublicOverview } from '../hooks/usePublicOverviews'
import StructuredData from '../components/StructuredData'
import LoadFailure from '../components/LoadFailure'
import AiBadge from '../components/ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { useFeedback } from '../components/FeedbackProvider'
import { SourcesList } from '../components/research/SourcesList'
import { OverviewStands } from '../components/overview/OverviewStands'
import { OverviewTimeline } from '../components/overview/OverviewTimeline'
import { countLine, ONGOING_METHOD_HREF, overviewHead, overviewUrl, statusLine } from '../components/overview/overviewCopy'

const BACK_LINK = `text-brand-700 hover:text-brand-800 font-normal ${FOCUS_RING} rounded px-1`

const label = AI_DISCLOSURE_COPY.overviewLabel

/**
 * The page's head tags. The backend writes the same title, description, address and image for
 * crawlers that run no JavaScript (`overviewPreview`, server/src/services/pagePreviews.ts).
 */
function OverviewHead({ overview }: { overview: PublicOverview }) {
  const { title, description } = overviewHead(overview)
  const url = overviewUrl(overview.slug)
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description.slice(0, 160)} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description.slice(0, 200)} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={url} />
        {CommonOgTags(sectionOgImage('ongoing'))}
      </Helmet>
      <StructuredData data={buildOverviewSchema(overview, description)} />
      <StructuredData
        data={buildBreadcrumbSchema([{ name: 'Home', url: SEO.siteUrl }, { name: 'Ongoing stories', url: `${SEO.siteUrl}/ongoing` }, { name: overview.title }])}
      />
    </>
  )
}

function NotFound() {
  return (
    <div className="page-section text-center">
      {/* The address answers 200 (the app shell), so the view itself keeps search engines away */}
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <h1 className="page-title">Ongoing Story Not Found</h1>
      <p className="text-neutral-500 mb-6">This ongoing story may have been taken down or is not public.</p>
      <Link to="/" className={BACK_LINK}>
        &larr; Back to home
      </Link>
    </div>
  )
}

/** "Summary and timeline by [AI], from our stories and their sources." then "How it works", leading to the methodology's section on ongoing stories. */
function OverviewLabel() {
  return (
    <p className="text-sm text-neutral-600">
      <span>
        {label.lead} <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="align-middle text-neutral-700" />
        {label.tail}
      </span>{' '}
      <Link to={ONGOING_METHOD_HREF} className={TEXT_LINK}>
        {AI_DISCLOSURE_COPY.howItWorksLinkText}
      </Link>
    </p>
  )
}

/**
 * An ongoing story's page, `/ongoing/:slug` (`.context/public-website.md`, "Ongoing stories"): the
 * header (where it stands in time, the area, the AI title, the count and last change, the AI
 * label), "Where this stands" and "What's being done" while the API serves them, the timeline, the
 * sources the summary cites, and "Report an error". Not prerendered; a 404 while overviews are
 * switched off, or for one that is not public, shows "not found" with its `noindex`.
 */
export default function OverviewPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const query = usePublicOverview(slug)
  const overview = query.data
  const { openFeedback } = useFeedback()
  // Never prerendered: the not-found view and its noindex always show (lib/loadState.ts)
  const loadState = loadStateOf(query, false)

  if (loadState === 'loading')
    return (
      <div className="page-section min-h-[60vh]" aria-busy="true">
        <p className="text-neutral-500">Loading the ongoing story…</p>
      </div>
    )
  if (loadState === 'failed')
    return (
      <LoadFailure title="This ongoing story couldn't load" query={query} className="page-section">
        <Link to="/" className={BACK_LINK}>
          &larr; Back to home
        </Link>
      </LoadFailure>
    )
  if (!overview) return <NotFound />

  const colors = getCategoryColor(overview.area?.slug ?? 'general-news')
  const sources = new Map(overview.sources.map(source => [source.id, source]))
  return (
    <>
      <OverviewHead overview={overview} />
      <article className="page-section">
        <header className="mb-10 border-b border-neutral-100 pb-8">
          <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold uppercase tracking-widest text-neutral-500">
            <span>{statusLine(overview)}</span>
            {overview.area && (
              <Link
                to={`/issues/${encodeURIComponent(overview.area.slug)}`}
                className={`inline-flex min-h-6 items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 normal-case tracking-normal text-neutral-700 hover:border-neutral-400 ${FOCUS_RING}`}
              >
                <span className={`h-2 w-2 rounded-full ${colors.dotBg}`} aria-hidden="true" />
                {overview.area.name}
              </Link>
            )}
          </p>
          <h1 className="mb-4 text-3xl md:text-4xl lg:text-5xl font-bold leading-tight" data-ai-generated="title">
            {overview.title}
          </h1>
          <p className="mb-2 text-sm text-neutral-600">{countLine(overview)}</p>
          <OverviewLabel />
        </header>

        {overview.stands && <OverviewStands stands={overview.stands} sources={sources} accent={colors.hex} />}
        <OverviewTimeline entries={overview.entries} accent={colors.hex} />
        {overview.sources.length > 0 && <SourcesList sources={overview.sources} marker="stands" />}

        {/* Report an error: queues the ongoing story's review, at most once a week (.context/overviews.md, "Reviews") */}
        <p className="text-sm text-neutral-600 text-right">
          Spotted a mistake?{' '}
          <button type="button" onClick={() => openFeedback({ id: overview.id, title: overview.title, kind: 'overview' })} className={TEXT_LINK}>
            Report an error
          </button>
        </p>

        <div className="mt-10 border-t border-neutral-200 pt-6">
          <Link to="/ongoing" className={BACK_LINK}>
            &larr; All ongoing stories
          </Link>
        </div>
      </article>
    </>
  )
}
