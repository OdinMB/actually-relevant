/**
 * Skeleton placeholder for a newsletter issue's web edition.
 * Matches the title, date, AI label, intro and story blocks to prevent CLS.
 */
export default function NewsletterIssueSkeleton() {
  return (
    <div className="page-section py-16 animate-pulse" aria-hidden="true">
      <div className="h-10 md:h-12 bg-neutral-300 rounded w-2/3 mx-auto mb-3" />
      <div className="h-4 bg-neutral-200 rounded w-40 mx-auto mb-6" />
      <div className="h-5 bg-neutral-200 rounded w-full mb-2" />
      <div className="h-5 bg-neutral-200 rounded w-3/4 mb-10" />
      {[1, 2, 3].map(i => (
        <div key={i} className="mb-10">
          <div className="h-3 bg-neutral-200 rounded w-24 mb-3" />
          <div className="h-7 bg-neutral-300 rounded w-4/5 mb-3" />
          <div className="h-4 bg-neutral-200 rounded w-56 mb-4" />
          <div className="h-4 bg-neutral-100 rounded w-full mb-2" />
          <div className="h-4 bg-neutral-100 rounded w-5/6" />
        </div>
      ))}
    </div>
  )
}
