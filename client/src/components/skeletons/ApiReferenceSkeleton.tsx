/**
 * Placeholder for the Scalar API reference on /developers while its chunk loads.
 * Fills the same full-height area as the reference (sidebar + content column)
 * so the page does not shift when the reference replaces it.
 */
export default function ApiReferenceSkeleton() {
  return (
    <div
      className="flex min-h-[calc(100vh-3rem)] animate-pulse"
      data-testid="api-reference-skeleton"
      aria-busy="true"
      aria-label="Loading API reference"
      role="status"
    >
      <div className="hidden w-72 shrink-0 border-r border-neutral-200 p-4 md:block">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="mb-3 h-4 w-3/4 rounded bg-neutral-100" />
        ))}
      </div>
      <div className="flex-1 p-6 md:p-10">
        <div className="mb-4 h-8 w-1/2 rounded bg-neutral-200" />
        <div className="mb-2 h-4 w-full rounded bg-neutral-100" />
        <div className="mb-2 h-4 w-5/6 rounded bg-neutral-100" />
        <div className="mb-8 h-4 w-2/3 rounded bg-neutral-100" />
        <div className="h-48 w-full rounded bg-neutral-100" />
      </div>
    </div>
  )
}
