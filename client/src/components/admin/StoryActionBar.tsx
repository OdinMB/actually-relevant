import { useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronUpIcon } from '@heroicons/react/20/solid'
import type { Story } from '@shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ReasonButton } from '../ui/ReasonButton'
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks'
import { useResearchAction } from '../../hooks/useResearch'
import { useStoryActions } from '../../hooks/useStoryActions'
import { useGatherAction } from '../../hooks/useStoryContextAdmin'
import { isResearched } from './ResearchVersion'
import { STICKY_ACTION_BAR } from './stickyActionBar'
import { ACTION_LABELS, actionConfirmation, busyReason, publishRefusal, statusActions, type ActionConfirmation, type StoryAction } from './storyActions'

type BarStory = Pick<Story, 'id' | 'status' | 'relevance' | 'preResearch'>

/** An action as the bar shows it: its label, why it cannot run now (null when it can), and what it does. */
interface Entry {
  action: StoryAction
  label: string
  reason: string | null
  run: () => void
}

/** The bar's other actions on a phone: a menu above the button, a closed action with its reason in words (a tooltip needs a hover). */
function MoreActions({ entries, onChoose }: { entries: Entry[]; onChoose: (entry: Entry) => void }) {
  return (
    <Menu as="div" className="relative md:hidden">
      <MenuButton as={Button} type="button" variant="secondary">
        More
        <ChevronUpIcon className="h-4 w-4" aria-hidden="true" />
      </MenuButton>
      <MenuItems className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-md border border-neutral-200 bg-white py-1 shadow-lg focus:outline-none">
        {entries.map(entry => (
          <MenuItem key={entry.action} disabled={entry.reason !== null}>
            <button
              type="button"
              onClick={() => onChoose(entry)}
              className="block w-full px-3 py-2 text-left text-sm text-neutral-700 data-[focus]:bg-neutral-100 data-[disabled]:cursor-not-allowed data-[disabled]:text-neutral-400"
            >
              {entry.label}
              {entry.reason && <span className="mt-0.5 block text-xs text-neutral-600">{entry.reason}</span>}
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  )
}

interface StoryActionBarProps {
  story: BarStory
  /** The form holds edits not saved yet. */
  dirty: boolean
  saving: boolean
  onCancel: () => void
  /** Puts the form back to the story's saved values. */
  onDiscard: () => void
}

/**
 * The story page's sticky bar (`STICKY_ACTION_BAR`): the actions the story's status offers
 * (`statusActions`), its next step first and prominent while nothing is unsaved, the rest beside it
 * from `md` up and in a "More" menu below; then Cancel and Save. While the form saves, a status
 * change is under way or a task of this tab works on the story, every action stays visible, closed
 * with the reason. An action that writes the story asks first while edits are unsaved and discards
 * them on confirm; Re-assess always asks (`actionConfirmation`).
 */
export function StoryActionBar({ story, dirty, saving, onCancel, onDiscard }: StoryActionBarProps) {
  const actions = useStoryActions()
  const { processingIds } = useBackgroundTasks()
  const research = useResearchAction(story)
  const gather = useGatherAction(story.id)
  const [asking, setAsking] = useState<{ entry: Entry; confirmation: ActionConfirmation } | null>(null)

  const busy = busyReason({ saving, changingStatus: actions.changingStatus, processing: processingIds.has(story.id) })
  const runs: Record<Exclude<StoryAction, 'research' | 'gather'>, () => void> = {
    preassess: () => actions.preassess(story.id),
    assess: () => actions.assess(story.id),
    reassess: () => actions.assess(story.id),
    publish: () => actions.publish(story.id),
    reject: () => actions.setStatus(story.id, 'rejected'),
    trash: () => actions.setStatus(story.id, 'trashed'),
  }
  const entryOf = (action: StoryAction): Entry | null => {
    if (action === 'research') return research && { action, label: ACTION_LABELS.research, reason: busy ?? research.reason, run: research.start }
    if (action === 'gather') return gather && { action, label: gather.label, reason: busy ?? gather.reason, run: gather.start }
    return { action, label: ACTION_LABELS[action], reason: busy ?? (action === 'publish' ? publishRefusal(story) : null), run: runs[action] }
  }

  const offered = statusActions(story.status)
  const primary = offered.primary ? entryOf(offered.primary) : null
  const others = offered.others.map(entryOf).filter((e): e is Entry => e !== null)

  const choose = (entry: Entry) => {
    if (entry.reason) return
    const confirmation = actionConfirmation(entry.action, { dirty, researched: isResearched(story) })
    if (confirmation) setAsking({ entry, confirmation })
    else entry.run()
  }
  const confirm = () => {
    if (!asking) return
    if (asking.confirmation.discards) onDiscard()
    asking.entry.run()
    setAsking(null)
  }

  const button = (entry: Entry, variant: 'primary' | 'secondary' | 'ghost') => (
    <ReasonButton key={entry.action} type="button" variant={variant} reason={entry.reason} onClick={() => choose(entry)}>
      {entry.label}
    </ReasonButton>
  )

  return (
    <div role="region" aria-label="Story actions" className={STICKY_ACTION_BAR}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Save is the one to press while edits are unsaved */}
        {primary && button(primary, dirty ? 'secondary' : 'primary')}
        {others.length > 0 && (
          <>
            <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
              {others.map(entry => button(entry, entry.action === 'trash' ? 'ghost' : 'secondary'))}
            </div>
            <MoreActions entries={others} onChoose={choose} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        onConfirm={confirm}
        title={asking?.confirmation.title ?? ''}
        description={asking?.confirmation.description}
        confirmLabel={asking?.confirmation.confirmLabel}
        variant={asking?.confirmation.variant}
      />
    </div>
  )
}
