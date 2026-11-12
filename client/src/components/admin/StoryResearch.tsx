import { useState } from 'react'
import type { ResearchRun, ResearchUsage, Story } from '@shared/types'
import { ReasonButton } from '../ui/ReasonButton'
import { Select } from '../ui/Select'
import { useResearchRuns, useResearchUsage, useStartResearch } from '../../hooks/useResearch'
import { formatDateWithTime } from '../../lib/constants'
import { ResearchRunView, verdictName } from './ResearchRunView'

/** The statuses a run may start from (server: `RESEARCHABLE_STATUSES` in services/researchInput.ts). */
const RESEARCHABLE: readonly string[] = ['analyzed', 'selected', 'published']

const money = (v: number) => `$${v.toFixed(2)}`

/** Why the Research button does nothing now, or null when a run may start. */
export function researchRefusal(story: Pick<Story, 'status'>, usage: ResearchUsage | undefined, inProgress: boolean): string | null {
  if (!usage) return 'Research usage could not be loaded'
  if (usage.refusal) return usage.refusal
  if (!RESEARCHABLE.includes(story.status)) return `Only analyzed, selected or published stories can be researched; this one is ${story.status}`
  if (inProgress) return 'A research run of this story is in progress'
  return null
}

function runLabel(run: ResearchRun): string {
  const outcome = run.status === 'completed' && run.verdict ? verdictName(run.verdict) : run.status
  return `${formatDateWithTime(run.startedAt)} · ${outcome} · $${run.costUsd.toFixed(3)}`
}

/**
 * The story's research section in the edit form: the month's spend against the cap, the Research
 * button (visible with its reason when a run cannot start) and the story's runs. Hidden against a
 * backend without research. A run writes nothing to the story; its verdict is only shown.
 */
export function StoryResearch({ story }: { story: Pick<Story, 'id' | 'status'> }) {
  const usage = useResearchUsage()
  const runs = useResearchRuns(story.id, usage.data != null)
  const { start, running } = useStartResearch(story.id)
  const [chosenId, setChosenId] = useState<string | null>(null)

  if (usage.isPending || usage.data === null) return null

  const list = runs.data ?? []
  const inProgress = running || list.some(r => r.status === 'running')
  const reason = researchRefusal(story, usage.data, inProgress)
  const chosen = list.find(r => r.id === chosenId) ?? list[0]
  const selectId = `research-run-${story.id}`

  return (
    <div className="border-t border-neutral-200 pt-4 space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Research</h3>
        <p className="text-sm text-neutral-600">
          Admin only, nothing is published.
          {usage.data &&
            ` This month: ${money(usage.data.monthToDateUsd)} of ${money(usage.data.monthlyCapUsd)} spent; each run reserves ${money(usage.data.reservationUsd)} until it ends.`}
        </p>
      </div>
      <ReasonButton type="button" variant="secondary" reason={reason} onClick={start}>
        Research this story
      </ReasonButton>
      {runs.isError && <p className="text-sm text-red-700">The research runs could not be loaded.</p>}
      {list.length > 0 && chosen && (
        <>
          <Select
            id={selectId}
            label="Run"
            value={chosen.id}
            onChange={e => setChosenId(e.target.value)}
            options={list.map(r => ({ value: r.id, label: runLabel(r) }))}
          />
          <ResearchRunView run={chosen} />
        </>
      )}
      {runs.isSuccess && list.length === 0 && <p className="text-sm text-neutral-500">No research runs yet.</p>}
    </div>
  )
}
