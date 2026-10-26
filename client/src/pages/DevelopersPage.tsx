import { lazy, Suspense, useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { ChunkErrorBoundary } from '../components/ui/ChunkErrorBoundary'
import { ApiReferenceSkeleton } from '../components/skeletons'
import { API_BASE, OPENAPI_SPEC_URL } from '../lib/api'
import { SEO, CommonOgTags } from '../lib/seo'

const META = {
  title: 'API Documentation - Actually Relevant',
  description:
    'Public API documentation for Actually Relevant. Access published stories, issues, and RSS feeds programmatically, with endpoints and example requests.',
  url: `${SEO.siteUrl}/developers`,
}

// The Scalar reference is several MB. Loading it as its own chunk keeps this
// page small, so its title, description and intro are in the DOM before the
// prerenderer's render-complete snapshot; the reference fills in afterwards.
const ApiReference = lazy(() => import('../components/developers/ApiReference'))

/** Takes the reference's place if its chunk fails to load or Scalar throws, leaving the rest of the page as it is. */
function ApiReferenceUnavailable() {
  return (
    <div role="alert" className="px-4 py-6">
      <h2 className="text-base font-semibold text-neutral-800">The API reference couldn't load</h2>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">
        The site may have been updated since you opened this page, or the connection dropped. Reload to try again, or read the{' '}
        <a
          href={OPENAPI_SPEC_URL}
          className="rounded text-brand-700 underline hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          OpenAPI spec as raw JSON
        </a>
        .
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-3 inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-sm font-normal text-white hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        Reload page
      </button>
    </div>
  )
}

export default function DevelopersPage() {
  // Mount the lazy reference only after the page itself has committed. If it
  // suspended in the first render, React would throttle revealing the nested
  // fallback (up to ~500ms after the route's own spinner) and the prerender
  // snapshot would capture the spinner instead of this page.
  const [pageMounted, setPageMounted] = useState(false)
  useEffect(() => setPageMounted(true), [])

  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>
      <div className="border-b border-neutral-200 bg-white px-4 py-3 flex items-center gap-3">
        <Link to="/" className="text-sm text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1">
          &larr; Actually Relevant
        </Link>
        <span className="text-neutral-300">|</span>
        <span className="text-sm font-medium text-neutral-700">API Documentation</span>
        <span className="text-neutral-300">|</span>
        <span className="text-xs text-amber-600 font-medium">Not a stable API &mdash; use at your own risk</span>
      </div>
      <section className="border-b border-neutral-200 bg-white px-4 py-5">
        <h1 className="text-2xl font-bold text-neutral-900">Actually Relevant API</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          Read published stories, issues, and RSS feeds over a free public HTTP API. No API key or signup is needed. The reference below lists every endpoint
          with its parameters and example requests.
        </p>
        <h2 className="mt-4 text-base font-semibold text-neutral-800">Incremental sync</h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">
          To pick up only what is new, pass the <code>datePublished</code> of the newest story you already have as <code>publishedSince</code>, and optionally a
          relevance floor. The RSS feeds take <code>minRelevance</code> too.
        </p>
        <pre className="mt-2 max-w-3xl overflow-x-auto rounded-lg bg-neutral-900 p-3 text-sm text-neutral-100">
          <code>{`curl "${API_BASE}/stories?publishedSince=2026-10-01T00:00:00Z&minRelevance=7"
curl "${API_BASE}/feed?minRelevance=7"`}</code>
        </pre>
      </section>
      <div className="min-h-[calc(100vh-3rem)]">
        {pageMounted ? (
          <ChunkErrorBoundary fallback={<ApiReferenceUnavailable />}>
            <Suspense fallback={<ApiReferenceSkeleton />}>
              <ApiReference />
            </Suspense>
          </ChunkErrorBoundary>
        ) : (
          <ApiReferenceSkeleton />
        )}
      </div>
    </>
  )
}
