import type { NewsletterEdition } from '@shared/types'
import { BRAND } from '../config'

/** The "Actually Uplifting" tag on an issue of that edition (archive list, issue page); nothing for a full issue. */
export default function NewsletterEditionTag({ edition, className = '' }: { edition: NewsletterEdition; className?: string }) {
  if (edition !== 'uplifting') return null
  return <span className={`inline-block rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ${className}`}>{BRAND.upliftingEdition}</span>
}
