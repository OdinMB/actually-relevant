import type { ResearchUsage, StoryStatus } from '@shared/types'
import { STORY_STATUSES } from '@shared/constants'
import { adminApi } from '../../lib/admin-api'
import type { useBackgroundTasks } from '../../hooks/useBackgroundTasks'
import type { BulkAction } from './BulkActionsBar'
import { bulkResearchConfirmation, type BulkResearchStory } from './bulkResearch'

/** What the stories list's confirmation dialog asks, and what its Confirm runs. */
export interface ConfirmAction {
  title: string
  description: string
  action: () => Promise<void>
}

type SocialChannel = 'bluesky' | 'mastodon'

/** A social channel's draft panel on the stories list. */
export interface DraftPanel {
  /** Opened empty, while the draft is made. */
  open: () => void
  show: (draft: unknown) => void
  close: () => void
}

/** What the handlers act through: the stories list's state, dialogs, toasts and tasks. */
export interface StoryBulkActionDeps {
  confirm: (confirmation: ConfirmAction) => void
  clearSelection: () => void
  toast: (type: 'success' | 'error', message: string) => void
  launchPolledTask: ReturnType<typeof useBackgroundTasks>['launchPolledTask']
  /** Runs when a polled task ends: the story queries are re-read. */
  onTaskComplete: () => void
  /** Undefined while it loads, null against a backend without research. */
  researchUsage: ResearchUsage | null | undefined
  startResearch: (chosen: BulkResearchStory[]) => void
  /** The title the list shows for a story, by which the bulk Research's outcome names it. */
  titleOf: (id: string) => string
  drafts: Record<SocialChannel, DraftPanel>
  openClusterDialog: () => void
  setStatus: (ids: string[], status: StoryStatus) => Promise<void>
}

type Handler = (ids: string[]) => void

/** An LLM bulk action that asks first, then runs as one polled server task over the stories. */
interface PolledAction {
  title: (count: number) => string
  description: string
  /** The progress toast's label. */
  label: (count: number) => string
  submitFn: (ids: string[]) => Promise<{ taskId: string }>
}

const POLLED_ACTIONS = {
  preassess: {
    title: n => `Pre-assess ${n} stories?`,
    description: 'This will run AI pre-assessment on the selected stories.',
    label: n => `Pre-assessing ${n} stories`,
    submitFn: ids => adminApi.stories.bulkPreassess(ids),
  },
  reclassify: {
    title: n => `Reclassify ${n} stories?`,
    description: 'This will re-run issue and emotion classification without changing ratings or status.',
    label: n => `Reclassifying ${n} stories`,
    submitFn: ids => adminApi.stories.bulkReclassify(ids),
  },
  assess: {
    title: n => `Assess ${n} stories?`,
    description: 'This will run full AI assessment on each selected story.',
    label: n => `Assessing ${n} stories`,
    submitFn: ids => adminApi.stories.bulkAssess(ids),
  },
  select: {
    title: n => `Select ${n} stories for publication?`,
    description: 'Selected stories will be marked for publishing.',
    label: n => `Selecting ${n} stories`,
    submitFn: ids => adminApi.stories.bulkSelect(ids),
  },
} satisfies Record<string, PolledAction>

/** A social post draft made for the selection and shown in its channel's panel. */
interface SocialDraft {
  channel: SocialChannel
  request: (ids: string[]) => Promise<unknown>
  failure: string
}

const SOCIAL_DRAFTS = {
  // One story: its own draft; several: the model picks the best and drafts it
  'bluesky-post': { channel: 'bluesky', request: ids => adminApi.bluesky.generateDraft(ids[0]!), failure: 'Failed to generate draft' },
  'bluesky-pick': { channel: 'bluesky', request: ids => adminApi.bluesky.pickAndDraft(ids), failure: 'Failed to pick and draft' },
  'mastodon-post': { channel: 'mastodon', request: ids => adminApi.mastodon.generateDraft(ids[0]!), failure: 'Failed to generate draft' },
  'mastodon-pick': { channel: 'mastodon', request: ids => adminApi.mastodon.pickAndDraft(ids), failure: 'Failed to pick and draft' },
} satisfies Record<string, SocialDraft>

/** One handler per table entry, keyed as the table is. */
function handlersFor<K extends string, V>(table: Record<K, V>, handler: (entry: V, key: K) => Handler): Record<K, Handler> {
  return Object.fromEntries((Object.keys(table) as K[]).map(key => [key, handler(table[key], key)])) as Record<K, Handler>
}

/**
 * The stories list's bulk actions, one handler per action the bar asks for (`BulkAction`): the LLM
 * actions that confirm and then run as a polled task (`POLLED_ACTIONS`), the bulk Research, the
 * social drafts (`SOCIAL_DRAFTS`), the cluster dialog and the status changes.
 */
export function storyBulkActions(deps: StoryBulkActionDeps): Record<BulkAction, Handler> {
  const polled =
    (entry: PolledAction, key: keyof typeof POLLED_ACTIONS): Handler =>
    ids =>
      deps.confirm({
        title: entry.title(ids.length),
        description: entry.description,
        action: async () => {
          deps.clearSelection()
          deps.launchPolledTask({
            id: `${key}-${Date.now()}`,
            label: entry.label(ids.length),
            submitFn: () => entry.submitFn(ids),
            onComplete: deps.onTaskComplete,
            storyIds: ids,
          })
        },
      })

  const research: Handler = ids => {
    if (!deps.researchUsage) return
    const chosen = ids.map(id => ({ id, title: deps.titleOf(id) }))
    deps.confirm({
      ...bulkResearchConfirmation(ids.length, deps.researchUsage),
      action: async () => {
        deps.clearSelection()
        deps.startResearch(chosen)
      },
    })
  }

  const socialDraft =
    (entry: SocialDraft): Handler =>
    ids => {
      const panel = deps.drafts[entry.channel]
      panel.open()
      entry
        .request(ids)
        .then(panel.show)
        .catch((err: unknown) => {
          deps.toast('error', err instanceof Error ? err.message : entry.failure)
          panel.close()
        })
    }

  // A status change is instant: the dialog waits for it
  const status =
    (to: StoryStatus): Handler =>
    ids =>
      deps.confirm({
        title: `Set ${ids.length} stories to "${to}"?`,
        description: `This will update the status of ${ids.length} stories.`,
        action: async () => {
          await deps.setStatus(ids, to)
          deps.toast('success', `Updated ${ids.length} stories`)
          deps.clearSelection()
        },
      })

  return {
    ...handlersFor(POLLED_ACTIONS, polled),
    research,
    ...handlersFor(SOCIAL_DRAFTS, socialDraft),
    'create-cluster': () => deps.openClusterDialog(),
    ...(Object.fromEntries(STORY_STATUSES.map(to => [to, status(to)])) as Record<StoryStatus, Handler>),
  }
}
