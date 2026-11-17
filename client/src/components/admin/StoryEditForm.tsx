import { useMemo } from 'react'
import type { Story, StoryStatus, EmotionTag, Issue } from '@shared/types'
import { STORY_STATUSES, EMOTION_TAGS } from '@shared/constants'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import { useUpdateStory } from '../../hooks/useStories'
import { useEditForm } from '../../hooks/useEditForm'
import { useResearchLock } from '../../hooks/useResearchLock'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { formatStatus } from '../../lib/constants'
import { buildIssueOptions } from './StoryFiltersBar'
import { StoryContextAdmin } from './StoryContextAdmin'
import { ClusterSection, SocialPostsSection, SourceSection } from './StoryEditorSections'
import { StoryResearch } from './StoryResearch'
import { EDITOR_SECTION } from './storyEditorClasses'
import { STICKY_ACTION_BAR } from './stickyActionBar'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

interface StoryEditFormProps {
  story: Story
  issues: Issue[]
  /** After a save, and on Cancel: back to where the story was opened from. */
  onDone: () => void
  onBlueskyGenerate?: (storyId: string) => void
  onMastodonGenerate?: (storyId: string) => void
}

/** The form's values as the fields hold them: text, so a rating typed back to what it was counts as unchanged. */
function buildFormState(story: Story) {
  return {
    titleLabel: story.titleLabel ?? '',
    title: story.title ?? '',
    slug: story.slug ?? '',
    issueId: story.issueId ?? '',
    status: story.status,
    relevancePre: story.relevancePre == null ? '' : String(story.relevancePre),
    relevance: story.relevance == null ? '' : String(story.relevance),
    emotionTag: story.emotionTag ?? '',
    summary: story.summary ?? '',
    quote: story.quote ?? '',
    quoteAttribution: story.quoteAttribution ?? '',
    marketingBlurb: story.marketingBlurb ?? '',
    relevanceReasons: story.relevanceReasons ?? '',
    relevanceSummary: story.relevanceSummary ?? '',
    antifactors: story.antifactors ?? '',
    relevanceCalculation: story.relevanceCalculation ?? '',
  }
}

/**
 * The story's admin page body (`StoryDetailPage`): its fields on the left, from `xl` up, and beside
 * them the source, the cluster, the social posts, Research and Context; one column below `xl`.
 * Save and Cancel sit in a sticky bar at the end; unsaved edits hold every way off the page.
 */
export function StoryEditForm({ story, issues, onDone, onBlueskyGenerate, onMastodonGenerate }: StoryEditFormProps) {
  const updateStory = useUpdateStory()

  const initialState = useMemo(() => buildFormState(story), [story])

  const { form, setForm, set, isDirty, isPending, handleSubmit } = useEditForm({
    entityId: story.id,
    initialState,
    mutation: updateStory,
    toPayload: f => ({
      titleLabel: f.titleLabel || null,
      title: f.title || null,
      slug: f.slug || undefined,
      issueId: f.issueId || null,
      status: f.status as StoryStatus,
      relevancePre: f.relevancePre === '' ? null : Number(f.relevancePre),
      relevance: f.relevance === '' ? null : Number(f.relevance),
      emotionTag: (f.emotionTag || null) as EmotionTag | null,
      summary: f.summary || null,
      quote: f.quote || null,
      quoteAttribution: f.quoteAttribution || null,
      marketingBlurb: f.marketingBlurb || null,
      relevanceReasons: f.relevanceReasons || null,
      relevanceSummary: f.relevanceSummary || null,
      antifactors: f.antifactors || null,
      relevanceCalculation: f.relevanceCalculation || null,
    }),
    successMessage: 'Story updated',
    entityName: 'story',
    onSuccess: () => {
      leave.markSaved()
      onDone()
    },
  })
  const leave = useUnsavedChangesGuard(isDirty)
  const { researched, noteId: lockNoteId, lock } = useResearchLock(story, initialState, setForm)

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <div className={`${EDITOR_SECTION} space-y-4`}>
          {researched && (
            <p id={lockNoteId} className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              This story shows a researched version, so the fields it wrote are locked. Revert to single-source first to edit them (see Research).
            </p>
          )}
          <Input
            id="edit-title-label"
            label="Title Label"
            value={form.titleLabel}
            onChange={e => set('titleLabel', e.target.value)}
            placeholder="e.g. EU AI Act"
            {...lock}
          />
          <Input id="edit-title" label="Title" value={form.title} onChange={e => set('title', e.target.value)} {...lock} />
          {story.slug &&
            (story.datePublished ? (
              <Input id="edit-slug" label="Slug" value={form.slug} readOnly className="bg-neutral-50 text-neutral-500 cursor-not-allowed" />
            ) : (
              <Input id="edit-slug" label="Slug" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder="auto-generated-on-publish" />
            ))}
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              id="edit-status"
              label="Status"
              value={form.status}
              onChange={e => set('status', e.target.value as StoryStatus)}
              options={STORY_STATUSES.map(s => ({ value: s, label: formatStatus(s) }))}
            />
            <Select
              id="edit-emotion"
              label="Emotion"
              placeholder="None"
              value={form.emotionTag}
              onChange={e => set('emotionTag', e.target.value)}
              options={EMOTION_TAGS.map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))}
              {...lock}
            />
            <Select
              id="edit-issue"
              label="Issue"
              placeholder="From feed"
              value={form.issueId}
              onChange={e => set('issueId', e.target.value)}
              options={buildIssueOptions(issues)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              id="edit-rating-pre"
              label="Pre-rating"
              type="number"
              min="1"
              max="10"
              value={form.relevancePre}
              onChange={e => set('relevancePre', e.target.value)}
            />
            <Input id="edit-rating" label="Rating" type="number" min="1" max="10" value={form.relevance} onChange={e => set('relevance', e.target.value)} />
          </div>
          <Textarea id="edit-summary" label="Summary" rows={4} value={form.summary} onChange={e => set('summary', e.target.value)} {...lock} />
          <Input id="edit-quote" label="Quote" value={form.quote} onChange={e => set('quote', e.target.value)} {...lock} />
          <Input
            id="edit-quote-attribution"
            label="Quote Attribution"
            value={form.quoteAttribution}
            onChange={e => set('quoteAttribution', e.target.value)}
            placeholder="e.g. Dr. Smith, University of Oxford"
            {...lock}
          />
          <Textarea
            id="edit-blurb"
            label="Marketing Blurb"
            rows={3}
            value={form.marketingBlurb}
            onChange={e => set('marketingBlurb', e.target.value)}
            {...lock}
          />
          <Textarea
            id="edit-reasons"
            label="Relevance Reasons"
            rows={5}
            value={form.relevanceReasons}
            onChange={e => set('relevanceReasons', e.target.value)}
            {...lock}
          />
          <Textarea
            id="edit-relevance-summary"
            label="Relevance Summary"
            rows={2}
            value={form.relevanceSummary}
            onChange={e => set('relevanceSummary', e.target.value)}
            {...lock}
          />
          <Textarea id="edit-antifactors" label="Antifactors" rows={4} value={form.antifactors} onChange={e => set('antifactors', e.target.value)} {...lock} />
          <Textarea
            id="edit-calculation"
            label="Relevance Calculation"
            rows={4}
            value={form.relevanceCalculation}
            onChange={e => set('relevanceCalculation', e.target.value)}
          />
        </div>

        <div className="space-y-6">
          <SourceSection story={story} />
          <ClusterSection story={story} />
          <SocialPostsSection story={story} onBlueskyGenerate={onBlueskyGenerate} onMastodonGenerate={onMastodonGenerate} />
          {/* Research (admin only; a run writes to the story only when an editor uses its version) */}
          <StoryResearch story={story} />
          {/* Context cards (shown once the story has a run or can have one gathered); hiding or moving one is the editor's only change */}
          <StoryContextAdmin story={story} />
        </div>
      </div>

      <div role="region" aria-label="Story actions" className={STICKY_ACTION_BAR}>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={isPending} disabled={!isDirty}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
      <UnsavedChangesDialog leave={leave} />
    </form>
  )
}
