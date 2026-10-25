import AiBadge from './AiBadge'
import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

/**
 * A page subtitle with the "AI" badge inline between `lead` and `tail` as its only "AI"
 * (the /podcast and /newsletter subtitles). Screen readers hear the badge as the word "AI",
 * so the sentence reads the same aloud.
 */
export default function AiSubtitle({ copy, className = 'page-intro' }: { copy: { readonly lead: string; readonly tail: string }; className?: string }) {
  return (
    <p className={className}>
      {copy.lead} <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="align-middle text-neutral-700" />
      {copy.tail}
    </p>
  )
}
