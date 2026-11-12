import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ResearchedSource } from '@shared/types'

/**
 * The link to a research source: the outside article in a new tab, our earlier story by its slug,
 * and the children as plain text when the source has neither.
 */
export function SourceLink({ source, className, children }: { source: ResearchedSource; className: string; children: ReactNode }) {
  if (source.origin === 'earlier') {
    if (!source.slug) return <>{children}</>
    return (
      <Link to={`/stories/${encodeURIComponent(source.slug)}`} className={className}>
        {children}
      </Link>
    )
  }
  if (!source.url) return <>{children}</>
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  )
}
