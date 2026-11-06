import { useEffect, useRef } from 'react'
import ModalDialog from '../../components/ModalDialog'
import { BRAND } from '../../config'
import { FOCUS_RING } from '../../lib/control-classes'
import SeeAllNewsLink from './SeeAllNewsLink'

/** The dialog's way out, a link that looks like the public dialogs' primary buttons. */
const PRIMARY_LINK = `inline-block px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors ${FOCUS_RING} focus-visible:ring-offset-2`

/**
 * What the edition is. Focus starts on the heading, not on the first control, so a screen reader
 * reads the explanation first and a reflex Enter does not leave the edition. ModalDialog opens the
 * dialog in its own effect, after this one, and the browser then focuses the first control, so the
 * heading takes focus a frame later.
 */
function AboutEdition({ onClose }: { onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-neutral-900 mb-3 focus:outline-none">
        {BRAND.upliftingEdition}
      </h2>
      <p className="text-neutral-600 leading-relaxed">
        Only the uplifting stories from Actually Relevant&rsquo;s daily selection of news that matters to humanity. AI tags each story&rsquo;s tone; Actually
        Uplifting shows the ones tagged uplifting.
      </p>
      <p className="mt-3 text-neutral-600 leading-relaxed">Fewer stories make the cut, so this edition changes more slowly.</p>
      <div className="mt-6">
        <SeeAllNewsLink className={PRIMARY_LINK} onFollow={onClose} />
      </div>
    </>
  )
}

/** The dialog the edition row's info button opens: what Actually Uplifting is, and the row's way out. */
export default function UpliftingEditionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalDialog open={open} onClose={onClose} title={BRAND.upliftingEdition}>
      <AboutEdition onClose={onClose} />
    </ModalDialog>
  )
}
