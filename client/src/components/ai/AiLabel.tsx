import AiBadge from './AiBadge'
import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

/** "AI" badge plus visible label text, for placement next to a headline. Unmounted pending copy review. */
export default function AiLabel({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm text-neutral-600 ${className}`.trim()}>
      <AiBadge decorative />
      <span>{AI_DISCLOSURE_COPY.labelText}</span>
    </span>
  )
}
