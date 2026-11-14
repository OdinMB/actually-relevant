import { useState, type Dispatch, type SetStateAction } from 'react'
import type { Story } from '@shared/types'
import { isResearched } from '../components/admin/ResearchVersion'

/**
 * The edit form's fields a researched version writes: the title label, title, summary, quote and
 * its attribution, blurb, the analysis and the emotion tag, never the rating or its calculation
 * (server: `SWAPPED_FIELDS` in services/researchSwap.ts, which refuses an edit to them with 409).
 */
export const SWAPPED_FORM_FIELDS = [
  'titleLabel',
  'title',
  'summary',
  'quote',
  'quoteAttribution',
  'marketingBlurb',
  'relevanceReasons',
  'relevanceSummary',
  'antifactors',
  'emotionTag',
] as const
type SwappedFormField = (typeof SWAPPED_FORM_FIELDS)[number]

const pickSwapped = <TForm extends Record<SwappedFormField, unknown>>(form: TForm) =>
  Object.fromEntries(SWAPPED_FORM_FIELDS.map(field => [field, form[field]])) as Pick<TForm, SwappedFormField>

/**
 * The edit form's research lock (`.context/story-research.md`, "Applying a run"). While the story
 * carries a researched version, `lock` disables the swapped fields and points them at the note
 * `noteId`. When the story gains or loses that version (an apply or a revert, then the refetch),
 * the swapped fields take the story's new values and every other unsaved edit stays: a dirty form
 * keeps its values otherwise, so a save after a revert would write the researched text back over
 * the restored single-source fields, and one after an apply would get the 409.
 */
export function useResearchLock<TForm extends Record<SwappedFormField, unknown>>(
  story: Pick<Story, 'id' | 'preResearch'>,
  initialState: TForm,
  setForm: Dispatch<SetStateAction<TForm>>,
) {
  const researched = isResearched(story)
  // Adjusted during render, as useEditForm takes over refetched data, so no frame shows stale values
  const [wasResearched, setWasResearched] = useState(researched)
  if (wasResearched !== researched) {
    setWasResearched(researched)
    setForm(form => ({ ...form, ...pickSwapped(initialState) }))
  }

  const noteId = `research-lock-${story.id}`
  const lock = researched ? { disabled: true, 'aria-describedby': noteId, className: 'bg-neutral-50 text-neutral-500 cursor-not-allowed' } : {}
  return { researched, noteId, lock }
}
