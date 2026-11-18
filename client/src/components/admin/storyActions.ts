import type { Story, StoryStatus } from '@shared/types'

/*
 * The story page's actions (`StoryActionBar`): which a story's status offers, what each asks first,
 * and why one cannot run now. Each runs as the stories list runs it (`useStoryActions`).
 */

export type StoryAction = 'preassess' | 'assess' | 'reassess' | 'publish' | 'research' | 'gather' | 'research-again' | 'reject' | 'trash'

/** The labels of the actions; Gather context's depends on the story's runs, so the bar names it. */
export const ACTION_LABELS: Record<Exclude<StoryAction, 'gather'>, string> = {
  preassess: 'Pre-assess',
  assess: 'Assess',
  reassess: 'Re-assess',
  publish: 'Publish',
  research: 'Research',
  'research-again': 'Research again',
  reject: 'Reject',
  trash: 'Trash',
}

/**
 * The actions each status offers, as the stories list offers them (its row actions, row menu and
 * bulk bar): the pipeline's next step as `primary` (pre-assess, assess, publish), then the rest.
 * Publish on every status but published, an editor's publish being the override from rejected and
 * trashed too; Re-assess once a story was assessed or rejected (the server refuses a trashed one);
 * Research where a run may start (`RESEARCHABLE` in `hooks/useResearch.ts`); Gather context on a published
 * story; Reject and Trash on every status but their own. `statusActions` swaps in "Research again"
 * while research passes are on.
 */
const STATUS_ACTIONS: Record<StoryStatus, { primary: StoryAction | null; others: StoryAction[] }> = {
  fetched: { primary: 'preassess', others: ['publish', 'reject', 'trash'] },
  pre_analyzed: { primary: 'assess', others: ['publish', 'reject', 'trash'] },
  analyzed: { primary: 'publish', others: ['reassess', 'research', 'reject', 'trash'] },
  selected: { primary: 'publish', others: ['reassess', 'research', 'reject', 'trash'] },
  published: { primary: null, others: ['reassess', 'research', 'gather', 'reject', 'trash'] },
  rejected: { primary: null, others: ['publish', 'reassess', 'trash'] },
  trashed: { primary: null, others: ['publish', 'reject'] },
}

/**
 * While research passes are on (`PassUsage.on`), "Research again" stands where Research stood and
 * Gather context goes: one pass does both. Off, the bar offers what it offered before passes.
 */
export function statusActions(status: StoryStatus, { passes = false }: { passes?: boolean } = {}): { primary: StoryAction | null; others: StoryAction[] } {
  const offered = STATUS_ACTIONS[status]
  if (!passes) return offered
  return { ...offered, others: offered.others.flatMap((a): StoryAction[] => (a === 'research' ? ['research-again'] : a === 'gather' ? [] : [a])) }
}

/** What an action changes on the story, in words ("Publishing changes …"), for the actions that write its fields or status. */
const CHANGES: Partial<Record<StoryAction, { doing: string; verb: string }>> = {
  preassess: { doing: 'Pre-assessing', verb: 'pre-assess' },
  assess: { doing: 'Assessing', verb: 'assess' },
  reassess: { doing: 'Re-assessing', verb: 're-assess' },
  publish: { doing: 'Publishing', verb: 'publish' },
  // A pass applies its own result to the story's fields
  'research-again': { doing: 'Researching again', verb: 'research again' },
  reject: { doing: 'Rejecting', verb: 'reject' },
  trash: { doing: 'Trashing', verb: 'trash' },
}

export interface ActionConfirmation {
  title: string
  description: string
  confirmLabel: string
  variant: 'primary' | 'danger'
  /** Confirming throws the form's unsaved edits away before the action runs. */
  discards: boolean
}

/**
 * What the bar asks before an action, or null to run it at once. An action that writes the story's
 * fields or status asks while edits are unsaved, and confirming discards them: kept, they would hold
 * the old values and a later Save would write them back over what the action did. Research and
 * Gather context write nothing on the story, so they never ask; "Research again" applies its pass's
 * result, so it asks as the other writing actions do. Re-assess always asks, as the bulk
 * Assess does: it replaces the AI-written fields an editor or research may have written.
 */
export function actionConfirmation(action: StoryAction, { dirty, researched }: { dirty: boolean; researched: boolean }): ActionConfirmation | null {
  const change = CHANGES[action]
  if (!change) return null
  const unsaved = ' Your unsaved changes are discarded.'
  if (action === 'reassess') {
    const dropped = researched ? ', and the researched version it shows is dropped' : ''
    return {
      title: 'Re-assess this story?',
      description: `This runs the full AI assessment again and replaces the story's AI-written fields${dropped}.${dirty ? unsaved : ''}`,
      confirmLabel: dirty ? 'Discard changes and re-assess' : 'Re-assess',
      variant: dirty ? 'danger' : 'primary',
      discards: dirty,
    }
  }
  if (!dirty) return null
  return {
    title: 'Discard your unsaved changes?',
    description: `${change.doing} changes the story, so the changes you have not saved are discarded. To keep them, save first.`,
    confirmLabel: `Discard and ${change.verb}`,
    variant: 'danger',
    discards: true,
  }
}

/** Why no action can start now: the form is saving, a status change is under way, or a task of this tab works on the story; null when none of these. */
export function busyReason({ saving, changingStatus, processing }: { saving: boolean; changingStatus: boolean; processing: boolean }): string | null {
  if (saving) return 'Saving the story'
  if (changingStatus) return "Changing the story's status"
  if (processing) return 'A task is working on this story; wait for it to finish'
  return null
}

/** Why Publish cannot run: a story without a rating stays unpublished (the stories list's bulk Publish holds the same). */
export function publishRefusal(story: Pick<Story, 'relevance'>): string | null {
  return story.relevance == null ? 'The story needs a rating before it can be published: assess it first' : null
}
