import { useState } from 'react'
import type { ResearchRun, Story } from '@shared/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ReasonButton } from '../ui/ReasonButton'
import { useToast } from '../ui/Toast'
import { useApplyResearch, useRevertResearch } from '../../hooks/useResearch'

/**
 * Which version of the story readers get: "Use this version" puts a run's researched version on the
 * story, "Revert to single-source" takes it back off (`.context/story-research.md`, "Applying a
 * run"). Both ask first, since on a published story readers see the change at once.
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

type StoryRef = Pick<Story, 'id' | 'status' | 'preResearch'>

/**
 * "Use this version" for one run that can give the story its researched version. `switchedOff` is
 * why research is off (the server refuses an apply then, though a revert still works), or null.
 */
export function UseRunVersion({ story, run, switchedOff }: { story: StoryRef; run: ResearchRun; switchedOff: string | null }) {
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
        reason={switchedOff ?? statusRefusal(story.status, 'take a researched version')}
        onClick={() => setConfirming(true)}
      >
        Use this version
      </ReasonButton>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
        title="Use this version?"
        description={`The story's headline, label, summary, quote, blurb, analysis and rating become this run's researched version, with its sources and the researched label. ${readers(story.status)} "Revert to single-source" gives back the version from before any research.`}
        confirmLabel="Use this version"
        loading={apply.isPending}
      />
    </>
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
        description={`The story gets back the headline, summary, analysis and rating it had before research, and loses the researched version and its sources. ${readers(story.status)} The runs stay.`}
        confirmLabel="Revert"
        variant="danger"
        loading={revert.isPending}
      />
    </div>
  )
}
