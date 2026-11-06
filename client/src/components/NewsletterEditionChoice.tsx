import type { NewsletterEdition } from '@shared/types'
import { BRAND } from '../config'

/** The two editions as the signup form names them (spec, "Newsletter"). */
const OPTIONS: { value: NewsletterEdition; name: string; what: string }[] = [
  { value: 'full', name: 'Actually Relevant', what: 'the full picture' },
  { value: 'uplifting', name: BRAND.upliftingEdition, what: 'only uplifting news' },
]

interface NewsletterEditionChoiceProps {
  /** ID prefix of the form it sits in, so two forms on one page keep separate groups. */
  idPrefix: string
  value: NewsletterEdition
  onChange: (edition: NewsletterEdition) => void
}

/** Which edition a new subscriber gets: one of two radio buttons, shown only while the server has the editions open. */
export default function NewsletterEditionChoice({ idPrefix, value, onChange }: NewsletterEditionChoiceProps) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-neutral-800">Which edition?</legend>
      <div className="space-y-2">
        {OPTIONS.map(option => (
          <div key={option.value} className="flex items-center gap-2">
            <input
              id={`${idPrefix}-edition-${option.value}`}
              type="radio"
              name={`${idPrefix}-edition`}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            />
            <label htmlFor={`${idPrefix}-edition-${option.value}`} className="py-1 text-sm text-neutral-700 cursor-pointer">
              <span className="font-semibold text-neutral-900">{option.name}</span>: {option.what}
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
