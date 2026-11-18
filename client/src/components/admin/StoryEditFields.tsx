import type { Issue, Story, StoryStatus } from '@shared/types'
import { STORY_STATUSES, EMOTION_TAGS } from '@shared/constants'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Select } from '../ui/Select'
import { formatStatus } from '../../lib/constants'
import type { useResearchLock } from '../../hooks/useResearchLock'
import { buildIssueOptions } from './StoryFiltersBar'
import { EDITOR_SECTION } from './storyEditorClasses'
import type { StoryForm, StoryFormErrors } from './storyForm'

/*
 * The story editor's fields, in the two tabs that hold them (`FIELD_TAB` in `storyTabs.ts`): the
 * text readers see, and the assessment. Each field's `name` is its form key, so the form can focus
 * a field that cannot be saved.
 */

interface FieldsProps {
  form: StoryForm
  set: <K extends keyof StoryForm>(key: K, value: StoryForm[K]) => void
  /** The research lock's props for a field a researched version wrote (`useResearchLock`). */
  lock: ReturnType<typeof useResearchLock>['lock']
}

/** The Story tab: the title label and title, the slug, the summary, the quote and the blurb. */
export function StoryTextFields({ form, set, lock, story }: FieldsProps & { story: Pick<Story, 'slug' | 'datePublished'> }) {
  return (
    <div className={`${EDITOR_SECTION} space-y-4`}>
      <Input
        id="edit-title-label"
        name="titleLabel"
        label="Title Label"
        value={form.titleLabel}
        onChange={e => set('titleLabel', e.target.value)}
        placeholder="e.g. EU AI Act"
        {...lock}
      />
      <Input id="edit-title" name="title" label="Title" value={form.title} onChange={e => set('title', e.target.value)} {...lock} />
      {story.slug &&
        (story.datePublished ? (
          <Input id="edit-slug" name="slug" label="Slug" value={form.slug} readOnly className="bg-neutral-50 text-neutral-500 cursor-not-allowed" />
        ) : (
          <Input
            id="edit-slug"
            name="slug"
            label="Slug"
            value={form.slug}
            onChange={e => set('slug', e.target.value)}
            placeholder="auto-generated-on-publish"
          />
        ))}
      <Textarea id="edit-summary" name="summary" label="Summary" rows={4} value={form.summary} onChange={e => set('summary', e.target.value)} {...lock} />
      <Input id="edit-quote" name="quote" label="Quote" value={form.quote} onChange={e => set('quote', e.target.value)} {...lock} />
      <Input
        id="edit-quote-attribution"
        name="quoteAttribution"
        label="Quote Attribution"
        value={form.quoteAttribution}
        onChange={e => set('quoteAttribution', e.target.value)}
        placeholder="e.g. Dr. Smith, University of Oxford"
        {...lock}
      />
      <Textarea
        id="edit-blurb"
        name="marketingBlurb"
        label="Marketing Blurb"
        rows={3}
        value={form.marketingBlurb}
        onChange={e => set('marketingBlurb', e.target.value)}
        {...lock}
      />
    </div>
  )
}

/** The Assessment tab: status, emotion and issue, the two ratings, and the analysis behind them. */
export function AssessmentFields({ form, set, lock, issues, errors }: FieldsProps & { issues: Issue[]; errors: StoryFormErrors }) {
  return (
    <div className={`${EDITOR_SECTION} space-y-4`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          id="edit-status"
          name="status"
          label="Status"
          value={form.status}
          onChange={e => set('status', e.target.value as StoryStatus)}
          options={STORY_STATUSES.map(s => ({ value: s, label: formatStatus(s) }))}
        />
        <Select
          id="edit-emotion"
          name="emotionTag"
          label="Emotion"
          placeholder="None"
          value={form.emotionTag}
          onChange={e => set('emotionTag', e.target.value)}
          options={EMOTION_TAGS.map(e => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))}
          {...lock}
        />
        <Select
          id="edit-issue"
          name="issueId"
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
          name="relevancePre"
          label="Pre-rating"
          type="number"
          min="1"
          max="10"
          value={form.relevancePre}
          onChange={e => set('relevancePre', e.target.value)}
          error={errors.relevancePre}
        />
        <Input
          id="edit-rating"
          name="relevance"
          label="Rating"
          type="number"
          min="1"
          max="10"
          value={form.relevance}
          onChange={e => set('relevance', e.target.value)}
          error={errors.relevance}
        />
      </div>
      <Textarea
        id="edit-reasons"
        name="relevanceReasons"
        label="Relevance Reasons"
        rows={5}
        value={form.relevanceReasons}
        onChange={e => set('relevanceReasons', e.target.value)}
        {...lock}
      />
      <Textarea
        id="edit-relevance-summary"
        name="relevanceSummary"
        label="Relevance Summary"
        rows={2}
        value={form.relevanceSummary}
        onChange={e => set('relevanceSummary', e.target.value)}
        {...lock}
      />
      <Textarea
        id="edit-antifactors"
        name="antifactors"
        label="Antifactors"
        rows={4}
        value={form.antifactors}
        onChange={e => set('antifactors', e.target.value)}
        {...lock}
      />
      <Textarea
        id="edit-calculation"
        name="relevanceCalculation"
        label="Relevance Calculation"
        rows={4}
        value={form.relevanceCalculation}
        onChange={e => set('relevanceCalculation', e.target.value)}
      />
    </div>
  )
}
