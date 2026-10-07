import { useId } from 'react'
import { Button } from '../ui/Button'
import type { PodcastStoryDraft } from './podcastStoryDraft'

/** A failed save's errors, as the server gave them. */
export function StoryDraftErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <ul className="list-disc pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
    </div>
  )
}

/**
 * Save selection and Discard changes; always shown (disabled while nothing changed, or while the draft
 * cannot be saved), so the form does not shift when an edit starts. `blockedHint` says, beside Save,
 * what the draft needs before it can be saved.
 */
export function StoryDraftFooter({ draft, canSave = true, blockedHint }: { draft: PodcastStoryDraft; canSave?: boolean; blockedHint?: string }) {
  const hintId = useId()
  const hint = canSave ? undefined : blockedHint
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={draft.save} loading={draft.saving} disabled={!draft.dirty || !canSave} aria-describedby={hint ? hintId : undefined}>Save selection</Button>
      <Button size="sm" variant="ghost" onClick={draft.discard} disabled={!draft.dirty || draft.saving}>Discard changes</Button>
      {hint && <span id={hintId} className="text-sm text-neutral-600">{hint}</span>}
    </div>
  )
}
