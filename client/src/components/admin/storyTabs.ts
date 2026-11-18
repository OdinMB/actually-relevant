import type { StoryField, StoryForm, StoryFormErrors } from './storyForm'

/*
 * The story page's tabs (`StoryEditorTabs`): which there are, which form field sits on which, the
 * tab the address names (`?tab=`), and the marker each tab shows.
 */

export const STORY_TABS = ['story', 'assessment', 'source', 'research', 'context', 'social'] as const
export type StoryTab = (typeof STORY_TABS)[number]

export const STORY_TAB_LABELS: Record<StoryTab, string> = {
  story: 'Story',
  assessment: 'Assessment',
  source: 'Source',
  research: 'Research',
  context: 'Context',
  social: 'Social',
}

/**
 * The tab each form field sits on: the text readers see on Story; the status, classification,
 * ratings and the analysis behind them on Assessment. In the order the tabs show them.
 */
export const FIELD_TAB: Record<StoryField, 'story' | 'assessment'> = {
  titleLabel: 'story',
  title: 'story',
  slug: 'story',
  summary: 'story',
  quote: 'story',
  quoteAttribution: 'story',
  marketingBlurb: 'story',
  status: 'assessment',
  emotionTag: 'assessment',
  issueId: 'assessment',
  relevancePre: 'assessment',
  relevance: 'assessment',
  relevanceReasons: 'assessment',
  relevanceSummary: 'assessment',
  antifactors: 'assessment',
  relevanceCalculation: 'assessment',
}

/** Whether the tabs that depend on the story have something to show (each section hides itself otherwise). */
export interface TabAvailability {
  research: boolean
  context: boolean
  social: boolean
}

/** The story's tabs, in order: Story, Assessment and Source always; Research, Context and Social when they have something to show. */
export function availableTabs(available: TabAvailability): StoryTab[] {
  return STORY_TABS.filter(tab => !(tab in available) || available[tab as keyof TabAvailability])
}

/** The tab the address names when the story has it, else Story. */
export function resolveStoryTab(param: string | null, tabs: readonly StoryTab[]): StoryTab {
  return tabs.find(tab => tab === param) ?? 'story'
}

/** A tab's marker: a field it holds cannot be saved or its section could not be loaded, or a field it holds is edited and not saved. */
export type TabMark = 'error' | 'unsaved' | null

interface TabMarkInput {
  form: StoryForm
  saved: StoryForm
  errors: StoryFormErrors
  /** The sections that could not be loaded. */
  failed: { research: boolean; context: boolean }
}

export function tabMarks({ form, saved, errors, failed }: TabMarkInput): Record<StoryTab, TabMark> {
  const marks = Object.fromEntries(STORY_TABS.map(tab => [tab, null])) as Record<StoryTab, TabMark>
  for (const field of Object.keys(FIELD_TAB) as StoryField[]) {
    const tab = FIELD_TAB[field]
    if (errors[field]) marks[tab] = 'error'
    else if (form[field] !== saved[field] && marks[tab] === null) marks[tab] = 'unsaved'
  }
  if (failed.research) marks.research = 'error'
  if (failed.context) marks.context = 'error'
  return marks
}

/** The first field that cannot be saved, in the tabs' order, and its tab; null when the form can be saved. */
export function firstError(errors: StoryFormErrors): { field: StoryField; tab: StoryTab } | null {
  const field = (Object.keys(FIELD_TAB) as StoryField[]).find(f => errors[f])
  return field ? { field, tab: FIELD_TAB[field] } : null
}
