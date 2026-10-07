import { Link } from 'react-router-dom'
import AiBadge from './AiBadge'
import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

/**
 * Site-wide AI notice in the header on every public page, so it is seen at first exposure
 * (AI Act Art. 50(5)). The whole line links to the explainer. Rendered by BrandLogo as a
 * sibling of the home link, never inside it. Same type as the claim, one shade darker. Phones:
 * a second line under the claim, with the badge. From `md` up: continues the claim's line,
 * whose badge BrandLogo puts in front of the claim, so this line hides its own.
 */
export default function HeaderAiLine({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      to={AI_DISCLOSURE_COPY.howItWorksHref}
      onClick={onClick}
      aria-label={AI_DISCLOSURE_COPY.headerAiLineAccessibleName}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1 py-1 text-[10px] leading-4 md:text-[11px] uppercase tracking-[0.2em] text-neutral-600 transition-colors hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <AiBadge decorative className="md:hidden" />
      <span>{AI_DISCLOSURE_COPY.headerAiLine}</span>
      <span aria-hidden="true" className="tracking-normal">
        ›
      </span>
    </Link>
  )
}
