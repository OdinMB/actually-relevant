import { Link } from 'react-router-dom'
import { BRAND } from '../config'
import { FOCUS_RING } from '../lib/control-classes'
import { useUpliftingEdition } from '../contexts/PositivityContext'
import HeaderAiLine from './ai/HeaderAiLine'

/** The logo's box: 5:2 like the logo image, the same at every dial position, so swapping logos moves nothing. */
const LOGO_BOX = 'h-14 md:h-16 aspect-[5/2]'

/**
 * The Actually Uplifting wordmark: the 'ar' mark with "actually uplifting" in Nexa Bold. Inline SVG
 * rather than an image, because no licence on record covers drawing Nexa into images
 * (.context/seo.md), and rather than HTML text, because the fixed viewBox scales the same at every
 * breakpoint and keeps a fallback font inside the box. Its pink on white is a logotype, which
 * WCAG 1.4.3 exempts, as it does the Actually Relevant logo's.
 */
function UpliftingWordmark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 250 100" role="img" aria-label={BRAND.upliftingEdition} className={`${LOGO_BOX} ${className}`}>
      <image href="/images/optimized/logo-no-text-small-h.webp" x="9" y="19" width="87" height="62" />
      <text x="106" y="43" className="font-nexa font-bold fill-[#333]" fontSize="35">
        actually
      </text>
      <text x="106" y="77" className="font-nexa font-bold fill-brand-500" fontSize="35">
        uplifting
      </text>
    </svg>
  )
}

/**
 * Header brand block: the logo and claim link home; the AI line is a sibling link to the
 * explainer, never inside the home link. Phones stack claim and AI line under the logo; from
 * `md` up they share one line, "claim · AI line [AI]", with the logo centered above it.
 * In the Actually Uplifting edition (the dial at "Only uplifting") the logo is the edition's
 * wordmark, in the same box; the link still goes to `/`, which is the edition while the dial is there.
 */
export default function BrandLogo({ onClick }: { onClick?: () => void }) {
  const inEdition = useUpliftingEdition()
  // md+: the logo is lifted out of the row (absolute) into this padding, so it stays centered over the whole line
  const lifted = 'md:absolute md:top-0 md:left-1/2 md:-translate-x-1/2'

  return (
    <div className="relative flex flex-col items-center shrink-0 md:flex-row md:pt-[4.25rem]">
      <Link to="/" onClick={onClick} className={`flex flex-col items-center rounded ${FOCUS_RING} md:flex-row`}>
        {inEdition ? (
          <UpliftingWordmark className={lifted} />
        ) : (
          <picture className={lifted}>
            <source srcSet="/images/optimized/logo-text-horizontal-small-h.webp" type="image/webp" />
            <img src="/images/logo-text-horizontal.png" alt="Actually Relevant" className={LOGO_BOX} />
          </picture>
        )}
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
