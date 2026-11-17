import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Story, Issue } from '@shared/types'
import { useUpdateStory } from '../../hooks/useStories'
import { useEditForm } from '../../hooks/useEditForm'
import { useResearchLock } from '../../hooks/useResearchLock'
import { useStoryTabs } from '../../hooks/useStoryTabs'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { StoryActionBar } from './StoryActionBar'
import { StoryContextAdmin } from './StoryContextAdmin'
import { AssessmentFields, StoryTextFields } from './StoryEditFields'
import { ClusterSection, SocialPostsSection, SourceSection } from './StoryEditorSections'
import { StoryEditorTabs } from './StoryEditorTabs'
import { StoryResearch } from './StoryResearch'
import { buildFormState, storyFormErrors, toStoryPayload, type StoryField } from './storyForm'
import { FIELD_TAB, firstError, tabMarks } from './storyTabs'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

interface StoryEditFormProps {
  story: Story
  issues: Issue[]
  /** Cancel: back to where the story was opened from. */
  onCancel: () => void
  onBlueskyGenerate?: (storyId: string) => void
  onMastodonGenerate?: (storyId: string) => void
}

/**
 * The story's admin page body (`StoryDetailPage`): its sections as tabs (`StoryEditorTabs`, the
 * open one in the address), the text fields on Story and the assessment's on Assessment, then the
 * source and cluster, Research, Context and the social posts; under them the sticky action bar with
 * the story's actions, Cancel and Save (`StoryActionBar`). The form holds every tab's fields, so a
 * tab switch keeps unsaved edits; unsaved edits hold every way off the page. Save goes to the first
 * field that cannot be saved, on its tab, rather than sending the form; a save keeps the page open
 * on its tab, the form holding what the server saved.
 */
export function StoryEditForm({ story, issues, onCancel, onBlueskyGenerate, onMastodonGenerate }: StoryEditFormProps) {
  const updateStory = useUpdateStory()

  const initialState = useMemo(() => buildFormState(story), [story])

  const { form, setForm, set, isDirty, isPending, handleSubmit } = useEditForm({
    entityId: story.id,
    initialState,
    mutation: updateStory,
    toPayload: toStoryPayload,
    successMessage: 'Story updated',
    entityName: 'story',
    // The server's values, not the form's: it keeps a slug sent empty, and the story query that
    // brings the saved story in (`useUpdateStory`) then finds the form unedited
    onSuccess: saved => setForm(buildFormState(saved)),
  })
  const leave = useUnsavedChangesGuard(isDirty)
  const { researched, noteId: lockNoteId, lock } = useResearchLock(story, initialState, setForm)
  const { tabs, tab, setTab, failed } = useStoryTabs(story, !!(onBlueskyGenerate || onMastodonGenerate))
  const errors = storyFormErrors(form)
  const marks = tabMarks({ form, saved: initialState, errors, failed })

  // A field Save could not send is focused once its tab shows: the panel shows a frame or two after
  // the address names the tab (Headless UI follows `selectedIndex` in an effect), and a hidden field
  // takes no focus, so it is tried again each frame for a few
  const formRef = useRef<HTMLFormElement>(null)
  const [focusField, setFocusField] = useState<StoryField | null>(null)
  useEffect(() => {
    if (!focusField || FIELD_TAB[focusField] !== tab) return
    const field = formRef.current?.elements.namedItem(focusField)
    if (!(field instanceof HTMLElement)) return
    let frame = 0
    let tries = 10
    const attempt = () => {
      field.focus()
      if (document.activeElement === field || --tries === 0) setFocusField(null)
      else frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [focusField, tab])

  const submit = (e: FormEvent) => {
    const problem = firstError(errors)
    if (!problem) {
      void handleSubmit(e)
      return
    }
    e.preventDefault()
    setTab(problem.tab)
    setFocusField(problem.field)
  }

  return (
    // A flex column filling the page, so the bar sits at the bottom of the view under a short tab too
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-1 flex-col">
      {researched && (
        <p id={lockNoteId} className="mb-4 max-w-4xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This story shows a researched version, so the fields it wrote are locked. Revert to single-source first to edit them (in the Research tab).
        </p>
      )}
      <div className="flex-1">
        <StoryEditorTabs
          tabs={tabs}
          selected={tab}
          marks={marks}
          onSelect={setTab}
          panels={{
            story: <StoryTextFields form={form} set={set} lock={lock} story={story} />,
            assessment: <AssessmentFields form={form} set={set} lock={lock} issues={issues} errors={errors} />,
            source: (
              <>
                <SourceSection story={story} />
                <ClusterSection story={story} />
              </>
            ),
            // Admin only; a run writes to the story only when an editor uses its version
            research: <StoryResearch story={story} />,
            // Hiding or moving a card is the editor's only change to them
            context: <StoryContextAdmin story={story} />,
            social: <SocialPostsSection story={story} onBlueskyGenerate={onBlueskyGenerate} onMastodonGenerate={onMastodonGenerate} />,
          }}
        />
      </div>

      <StoryActionBar story={story} dirty={isDirty} saving={isPending} onCancel={onCancel} onDiscard={() => setForm(initialState)} />
      <UnsavedChangesDialog leave={leave} />
    </form>
  )
}
