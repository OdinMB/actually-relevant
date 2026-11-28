import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { PublicOverviewHead } from '@shared/types'
import { SEO, CommonOgTags } from '../lib/seo'
import { sectionOgImage } from '../lib/api'
import { getCategoryColor } from '../lib/category-colors'
import { FOCUS_RING } from '../lib/control-classes'
import { loadStateOf } from '../lib/loadState'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import { usePublicOverviews } from '../hooks/usePublicOverviews'
import StructuredData from '../components/StructuredData'
import LoadFailure from '../components/LoadFailure'
import AiBadge from '../components/ai/AiBadge'
import { countLine, statusLine } from '../components/overview/overviewCopy'

const BACK_LINK = `text-brand-700 hover:text-brand-800 font-normal ${FOCUS_RING} rounded px-1`

const TITLE = `Ongoing stories - ${SEO.siteName}`
// "…and where things stand now" waits for the stands to switch on (.context/overviews.md, "Where this stands")
const DESCRIPTION = 'The developments we follow as one story: each with a timeline of our stories.'
const URL = `${SEO.siteUrl}/ongoing`

function IndexHead() {
  return (
    <>
      <Helmet>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={URL} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={URL} />
        {CommonOgTags(sectionOgImage('ongoing'))}
      </Helmet>
      <StructuredData data={buildBreadcrumbSchema([{ name: 'Home', url: SEO.siteUrl }, { name: 'Ongoing stories' }])} />
    </>
  )
}

function NotFound() {
  return (
    <div className="page-section text-center">
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <h1 className="page-title">Page Not Found</h1>
      <p className="text-neutral-500 mb-6">There is nothing here yet.</p>
      <Link to="/" className={BACK_LINK}>
        &larr; Back to home
      </Link>
    </div>
  )
}

/** One ongoing story: where it stands in time and its area, its AI title linking its page, the count and last change. */
function OverviewRow({ overview }: { overview: PublicOverviewHead }) {
  const colors = getCategoryColor(overview.area?.slug ?? 'general-news')
  return (
    <li className={`border-l-4 ${colors.border} py-1 pl-4`}>
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
        {statusLine(overview)}
        {overview.area && <> · {overview.area.name}</>}
      </p>
      <h2 className="mt-1 text-xl font-bold leading-snug" data-ai-generated="title">
        <Link to={`/ongoing/${encodeURIComponent(overview.slug)}`} className={`text-neutral-900 hover:text-brand-800 ${FOCUS_RING} rounded`}>
          <AiBadge className="mr-1.5 align-middle" /> {overview.title}
        </Link>
      </h2>
      <p className="mt-1 text-sm text-neutral-600">{countLine(overview)}</p>
    </li>
  )
}

/**
 * `/ongoing` (`.context/public-website.md`, "Ongoing stories"): the public ongoing stories, the most
 * recently changed first. Not prerendered; "not found" with its `noindex` while overviews are
 * switched off, when the API says `on: false`.
 */
export default function OverviewsIndexPage() {
  const query = usePublicOverviews()
  // Never prerendered: the not-found view and its noindex always show (lib/loadState.ts)
  const loadState = loadStateOf(query, false)

  if (loadState === 'loading')
    return (
      <div className="page-section min-h-[60vh]" aria-busy="true">
        <p className="text-neutral-500">Loading the ongoing stories…</p>
      </div>
    )
  if (loadState === 'failed')
    return (
      <LoadFailure title="The ongoing stories couldn't load" query={query} className="page-section">
        <Link to="/" className={BACK_LINK}>
          &larr; Back to home
        </Link>
      </LoadFailure>
    )
  if (!query.data?.on) return <NotFound />

  const { overviews } = query.data
  return (
    <>
      <IndexHead />
      <div className="page-section">
        <h1 className="page-title">Ongoing Stories</h1>
        <p className="page-intro">The developments we follow as one story, the most recently changed first.</p>
        {overviews.length === 0 ? (
          <p className="text-center text-neutral-500">No ongoing stories right now.</p>
        ) : (
          <ul className="space-y-8">
            {overviews.map(overview => (
              <OverviewRow key={overview.slug} overview={overview} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
