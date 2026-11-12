import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ResearchedSource } from '@shared/types'
import { isHttpUrl } from '../../lib/urls'

/**
 * Where a research source links: our earlier story's page by its slug, or the outside article when
 * its address is http(s); null when it has neither. The server's schema already refuses any other
 * address; this holds the line again where the address becomes an href.
 */
export function sourceHref(source: ResearchedSource): string | null {
  if (source.origin === 'earlier') return source.slug ? `/stories/${encodeURIComponent(source.slug)}` : null
  return source.url && isHttpUrl(source.url) ? source.url : null
}

/**
 * The link to a research source: the outside article in a new tab, our earlier story by its slug,
 * and the children as plain text when the source has neither.
 */
export function SourceLink({ source, className, children }: { source: ResearchedSource; className: string; children: ReactNode }) {
  const href = sourceHref(source)
  if (!href) return <>{children}</>
  if (source.origin === 'earlier') {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  )
}
