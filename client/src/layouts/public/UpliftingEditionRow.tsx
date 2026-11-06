import { useState } from 'react'
import { BRAND } from '../../config'
import { useUpliftingEdition } from '../../contexts/PositivityContext'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import SeeAllNewsLink from './SeeAllNewsLink'
import UpliftingEditionDialog from './UpliftingEditionDialog'
import { InfoIcon } from './icons'

/**
 * The info button: a 24x24 target (WCAG 2.5.8) around a text-sized icon. The negative vertical
 * margin keeps it inside the text's 20px line box, so the row is no taller for it; the box reaches
 * into the row's padding, where no other target is. On phones the box's own padding around the
 * icon is the only gap on either side, which the row needs to fit one line; from `sm` up a margin
 * adds the gaps a space would. The button is an inline box, so the row can still wrap after it.
 */
const INFO_BUTTON = `inline-flex items-center justify-center min-w-6 min-h-6 -my-1 sm:ml-0.5 sm:mr-1 align-middle rounded-full text-brand-700 hover:text-brand-800 transition-colors ${FOCUS_RING}`

/** The row while the reader is in the edition; it owns the dialog's state, so leaving the edition resets it. */
function EditionRow() {
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <div className="bg-brand-50 border-b border-brand-100">
      <p className="max-w-6xl mx-auto px-3 sm:px-4 py-2 text-center text-[13px] leading-5 sm:text-sm">
        <strong className="text-brand-700">Only positive news from Actually Relevant.</strong>
        <button type="button" onClick={() => setAboutOpen(true)} aria-label={`About ${BRAND.upliftingEdition}`} className={INFO_BUTTON}>
          <InfoIcon className="w-4 h-4" />
        </button>
        <SeeAllNewsLink className={`${TEXT_LINK} whitespace-nowrap`} />
      </p>
      <UpliftingEditionDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}

/**
 * The Actually Uplifting edition's cue under the logo bar, shown only while the dial is at
 * "Only uplifting": the edition in one sentence, an info button whose dialog says what the edition
 * is, and its one way out, "See all news" (`SeeAllNewsLink`). On phones it is set at 13px with
 * tighter gaps and padding, so it fits one line from about 373px wide (390 and 375 included);
 * narrower, it wraps onto two centered lines, the sentence and icon, then the link (kept whole),
 * never cut off, so it reflows down to 320px. From `sm` up it is 14px, with room to spare.
 */
export default function UpliftingEditionRow() {
  return useUpliftingEdition() ? <EditionRow /> : null
}
