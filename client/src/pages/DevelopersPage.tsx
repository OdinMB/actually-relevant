import { lazy, Suspense, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ChunkErrorBoundary } from "../components/ui/ChunkErrorBoundary";
import { ApiReferenceSkeleton } from "../components/skeletons";

// The Scalar reference is several MB. Loading it as its own chunk keeps this
// page small, so its title, description and intro are in the DOM before the
// prerenderer's render-complete snapshot; the reference fills in afterwards.
const ApiReference = lazy(() => import("../components/developers/ApiReference"));

export default function DevelopersPage() {
  // Mount the lazy reference only after the page itself has committed. If it
  // suspended in the first render, React would throttle revealing the nested
  // fallback (up to ~500ms after the route's own spinner) and the prerender
  // snapshot would capture the spinner instead of this page.
  const [pageMounted, setPageMounted] = useState(false);
  useEffect(() => setPageMounted(true), []);

  return (
    <>
      <Helmet>
        <title>API Documentation - Actually Relevant</title>
        <meta
          name="description"
          content="Public API documentation for Actually Relevant. Access published stories, issues, and RSS feeds programmatically, with endpoints and example requests."
        />
      </Helmet>
      <div className="border-b border-neutral-200 bg-white px-4 py-3 flex items-center gap-3">
        <Link
          to="/"
          className="text-sm text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
        >
          &larr; Actually Relevant
        </Link>
        <span className="text-neutral-300">|</span>
        <span className="text-sm font-medium text-neutral-700">
          API Documentation
        </span>
        <span className="text-neutral-300">|</span>
        <span className="text-xs text-amber-600 font-medium">
          Not a stable API &mdash; use at your own risk
        </span>
      </div>
      <section className="border-b border-neutral-200 bg-white px-4 py-5">
        <h1 className="text-2xl font-bold text-neutral-900">
          Actually Relevant API
        </h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          Read published stories, issues, and RSS feeds over a free public
          HTTP API. No API key or signup is needed. The reference below lists
          every endpoint with its parameters and example requests.
        </p>
      </section>
      <div className="min-h-[calc(100vh-3rem)]">
        {pageMounted ? (
          <ChunkErrorBoundary>
            <Suspense fallback={<ApiReferenceSkeleton />}>
              <ApiReference />
            </Suspense>
          </ChunkErrorBoundary>
        ) : (
          <ApiReferenceSkeleton />
        )}
      </div>
    </>
  );
}
