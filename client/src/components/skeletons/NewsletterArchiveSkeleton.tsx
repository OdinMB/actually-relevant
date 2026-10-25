/**
 * Skeleton placeholder for the newsletter archive list.
 * Matches one row per issue (title line, then the date and story count) to prevent CLS.
 */
export default function NewsletterArchiveSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-neutral-100 animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="py-5">
          <div className="h-6 bg-neutral-300 rounded w-48 mb-2" />
          <div className="h-4 bg-neutral-200 rounded w-56" />
        </li>
      ))}
    </ul>
  )
}
