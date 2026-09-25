import { Link } from 'react-router-dom'
import AiBadge from './AiBadge'
import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

/**
 * Site-wide AI notice for the top of every public page, above the content, so it is
 * seen at first exposure (AI Act Art. 50(5)). It has no dismiss control on purpose:
 * how often it shows is part of the owner's copy decision. Unmounted pending copy review.
 */
export default function SiteAiNotice({ className = '' }: { className?: string }) {
  return (
    <p
      role="note"
      className={`border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-center text-sm text-neutral-600 ${className}`.trim()}
    >
      <AiBadge decorative className="mr-1.5 align-middle" />
      {AI_DISCLOSURE_COPY.siteNotice}{' '}
      <Link
        to={AI_DISCLOSURE_COPY.siteNoticeLinkHref}
        className="text-brand-700 underline hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
      >
        {AI_DISCLOSURE_COPY.siteNoticeLinkText}
      </Link>
    </p>
  )
}
