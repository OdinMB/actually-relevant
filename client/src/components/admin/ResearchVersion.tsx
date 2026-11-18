import { useState } from 'react'
import type { ArticleVersionView, ResearchRun, Story } from '@shared/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ReasonButton } from '../ui/ReasonButton'
import { useToast } from '../ui/Toast'
import { useApplyResearch, useRevertResearch } from '../../hooks/useResearch'
import { useUndoUpdate } from '../../hooks/useResearchPass'
import { formatDate } from '../../lib/constants'

/**
 * Which version of the story readers get: "Use this version" puts a run's researched version on the
 * story, "Revert to single-source" takes it back off (`.context/story-research.md`, "Applying a
 * run"), and "Undo this update" takes a research pass's update back. Each asks first, since on a
 * published story readers see the change at once.
 */

/** The statuses a researched version can be put on or taken off (server: the `research` stage in storyLifecycle.ts). */
const TAKES_RESEARCH: readonly string[] = ['analyzed', 'selected', 'published', 'rejected']

/** Whether the story carries a researched version: its single-source snapshot is set. */
export const isResearched = (story: Pick<Story, 'preResearch'>) => story.preResearch != null

/** A completed run with a draft that did not fall back to today's format; a run research rejected is one an editor may overrule. */
export const canUseVersion = (run: ResearchRun) => run.status === 'completed' && run.result?.draft != null && run.result.verdict.kind !== 'fallback'

/** Why the story's status refuses the action now, or null. */
function statusRefusal(status: Story['status'], action: string): string | null {
  if (TAKES_RESEARCH.includes(status)) return null
  if (status === 'trashed') return `A trashed story cannot ${action}: restore it first`
  return `Only analyzed, selected, published or rejected stories can ${action}; this one is ${status}`
}

const readers = (status: Story['status']) => (status === 'published' ? 'Readers see it at once.' : 'Readers see it once the story is published.')

/** What a revert restores: a snapshot an apply stored before research tagged its text (2026-11-14) keeps no emotion tag. */
const restored = (story: StoryRef) =>
  story.preResearch?.emotionTag !== undefined ? 'headline, summary, analysis and emotion tag' : 'headline, summary and analysis'

/** What an apply swaps: a run stored before research tagged its text (2026-11-14) leaves the emotion tag. */
const swapped = (run: ResearchRun) =>
  run.result?.draft?.emotionTag ? 'headline, label, summary, quote, blurb, analysis and emotion tag' : 'headline, label, summary, quote, blurb and analysis'

type StoryRef = Pick<Story, 'id' | 'status' | 'preResearch'>

/**
 * "Use this version" for one run that can give the story its researched version. `closed` is why
 * no run can be applied now (research switched off; the server refuses an apply then, though a
 * revert still works), or null.
 */
export function UseRunVersion({ story, run, closed }: { story: StoryRef; run: ResearchRun; closed: string | null }) {
  const [confirming, setConfirming] = useState(false)
  const apply = useApplyResearch(story.id)
  const { toast } = useToast()

  const confirm = () =>
    apply.mutate(run.id, {
      onSuccess: () => toast('success', 'Researched version applied'),
      onError: err => toast('error', err.message),
      onSettled: () => setConfirming(false),
    })

  return (
    <>
      <ReasonButton
        type="button"
        variant="secondary"
        reason={closed ?? statusRefusal(story.status, 'take a researched version')}
        onClick={() => setConfirming(true)}
      >
        Use this version
      </ReasonButton>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        title="Use this version?"
        description={`The story's ${swapped(run)} become this run's researched version, with its sources and the researched label. The story keeps its own rating. ${readers(story.status)} "Revert to single-source" gives back the version from before any research.`}
        confirmLabel="Use this version"
        loading={apply.isPending}
      />
    </>
  )
}

/**
 * "Undo this update" while the story's current version is a research pass's update
 * (`.context/research-passes.md`, "Undo and revert"): the version before goes back on the story and
 * the update's Update leaves the page. Asks first. Renders nothing otherwise: a first pass's version
 * is taken back by "Revert to single-source".
 */
export function UndoUpdate({ story, versions }: { story: StoryRef; versions: ArticleVersionView[] }) {
  const [confirming, setConfirming] = useState(false)
  const undo = useUndoUpdate(story.id)
  const { toast } = useToast()

  const current = versions.find(v => v.status === 'current')
  if (current?.kind !== 'update') return null
  const previous = versions.filter(v => v.number < current.number && v.status === 'superseded').sort((a, b) => b.number - a.number)[0]

  const confirm = () =>
    undo.mutate(undefined, {
      onSuccess: () => toast('success', 'Update undone'),
      onError: err => toast('error', err.message),
      onSettled: () => setConfirming(false),
    })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-neutral-700">
        The story shows version {current.number}, an update of {formatDate(current.createdAt)}.
      </p>
      <ReasonButton
        type="button"
        variant="secondary"
        reason={statusRefusal(story.status, 'take a researched version') ?? (previous ? null : 'No earlier version is left to restore')}
        onClick={() => setConfirming(true)}
      >
        Undo this update
      </ReasonButton>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        title="Undo this update?"
        description={`The story goes back to version ${previous?.number ?? ''}: the sections this update rewrote get their earlier text back, and its Update leaves the page. ${readers(story.status)} The facts its pass demoted are in use again, and the pass stays in the list.`}
        confirmLabel="Undo this update"
        variant="danger"
        loading={undo.isPending}
      />
    </div>
  )
}

/** That the story shows a researched version, with "Revert to single-source". Renders nothing for a single-source story. */
export function RevertToSingleSource({ story }: { story: StoryRef }) {
  const [confirming, setConfirming] = useState(false)
  const revert = useRevertResearch(story.id)
  const { toast } = useToast()

  if (!isResearched(story)) return null

  const confirm = () =>
    revert.mutate(undefined, {
      onSuccess: () => toast('success', 'Reverted to single-source'),
      onError: err => toast('error', err.message),
      onSettled: () => setConfirming(false),
    })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-neutral-700">This story shows a researched version.</p>
      <ReasonButton type="button" variant="secondary" reason={statusRefusal(story.status, 'be reverted')} onClick={() => setConfirming(true)}>
        Revert to single-source
      </ReasonButton>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        title="Revert to single-source?"
        description={`The story gets back the ${restored(story)} it had before research, and loses the researched version and its sources. ${readers(story.status)} The runs stay.`}
        confirmLabel="Revert"
        variant="danger"
        loading={revert.isPending}
      />
    </div>
  )
}
