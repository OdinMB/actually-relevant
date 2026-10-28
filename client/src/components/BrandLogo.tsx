import { Link } from 'react-router-dom'
import { BRAND } from '../config'
import HeaderAiLine from './ai/HeaderAiLine'

/**
 * Header brand block: the logo and claim link home; the AI line is a sibling link to the
 * explainer, never inside the home link. Phones stack claim and AI line under the logo; from
 * `md` up they share one line, "claim · AI line [AI]", with the logo centered above it.
 */
export default function BrandLogo({ onClick }: { onClick?: () => void }) {
  return (
    // md+: the logo is lifted out of the row (absolute) into this padding, so it stays centered over the whole line
    <div className="relative flex flex-col items-center shrink-0 md:flex-row md:pt-[4.25rem]">
      <Link to="/" onClick={onClick} className="flex flex-col items-center rounded focus-visible:ring-2 focus-visible:ring-brand-500 md:flex-row">
        <picture className="md:absolute md:top-0 md:left-1/2 md:-translate-x-1/2">
          <source srcSet="/images/optimized/logo-text-horizontal-small-h.webp" type="image/webp" />
          <img src="/images/logo-text-horizontal.png" alt="Actually Relevant" className="h-14 md:h-16 aspect-[5/2]" />
        </picture>
        {/* md+: leading-4 like the AI line, so both halves' line boxes are 16px and centering
            puts claim and AI text on one baseline (16.5px left them a fractional pixel apart) */}
        <span className="text-[10px] md:text-[11px] md:leading-4 uppercase tracking-[0.2em] text-neutral-500 mt-1 md:mt-0">
          {BRAND.claim.replace(/\.$/, '')}
        </span>
      </Link>
      <span aria-hidden="true" className="hidden md:inline text-[11px] leading-4 text-neutral-500 ml-1.5 mr-0.5">
        ·
      </span>
      {/* Site-wide AI notice at first exposure (AI Act Art. 50(5)); .context/ai-transparency.md */}
      <HeaderAiLine onClick={onClick} />
    </div>
  )
}
