import { useEffect, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import type { ClientOnErrorFunction } from 'react-router-dom'

/**
 * The router's `onError` (main.tsx): logs each error a route throws, during render or loading,
 * once and with its route pattern. It replaces React Router's own console line, so a route error
 * is not logged twice. Errors inside a lazy page are caught and logged by ChunkErrorBoundary.
 */
export const logRouteError: ClientOnErrorFunction = (error, { pattern, errorInfo }) => {
  console.error(`Route error on ${pattern}:`, error, ...(errorInfo ? [errorInfo] : []))
}

/**
 * The root route's `errorElement` (App.tsx): shown instead of React Router's default
 * "Unexpected Application Error" screen. It stands alone, without the site header and footer,
 * because the layout may be what failed. The error itself is never shown to readers.
 */
export default function RouteErrorPage() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The page under the reader was swapped out; move focus to the heading so it is announced
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <Helmet>
        <title>Something Went Wrong - Actually Relevant</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <div className="max-w-2xl text-center">
        <picture>
          <source srcSet="/images/optimized/logo-text-horizontal-small-h.webp" type="image/webp" />
          <img src="/images/logo-text-horizontal.png" alt="Actually Relevant" className="mx-auto mb-10 h-14 md:h-16 aspect-[5/2]" />
        </picture>
        <h1 ref={headingRef} tabIndex={-1} className="page-title focus:outline-none">
          Something went wrong
        </h1>
        <p className="page-intro">Reload the page to try again, or go to the homepage.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-base font-normal text-white transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Reload page
          </button>
          {/* A full page load, not a router Link: it also clears whatever in-memory state failed */}
          <a
            href="/"
            className="text-brand-700 hover:text-brand-800 underline underline-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
          >
            Go to the homepage
          </a>
        </div>
      </div>
    </main>
  )
}
