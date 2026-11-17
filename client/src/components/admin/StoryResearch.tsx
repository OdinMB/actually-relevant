import { useState } from 'react'
import type { EmotionTag, ResearchFallbackCategory, ResearchRun, ResearchUsage, Story } from '@shared/types'
import { EMOTION_TAGS } from '@shared/constants'
import { Select } from '../ui/Select'
import { useResearchRuns, useResearchUsage } from '../../hooks/useResearch'
import { formatDateWithTime } from '../../lib/constants'
import { fallbackName, ResearchRunView, verdictLabel, verdictName } from './ResearchRunView'
import { canUseVersion, RevertToSingleSource, UseRunVersion } from './ResearchVersion'
import { EDITOR_HEADING, EDITOR_SECTION } from './storyEditorClasses'

/** In the server's order (`FALLBACK_CATEGORIES` in services/researchChecks.ts). */
const FALLBACK_CATEGORIES: readonly ResearchFallbackCategory[] = ['no_other_coverage', 'not_confirmed', 'draft_failed_check', 'technical']

const money = (v: number) => `$${v.toFixed(2)}`

function runLabel(run: ResearchRun): string {
  const verdict = run.status === 'completed' && run.verdict ? (run.result ? verdictLabel(run.result.verdict) : verdictName(run.verdict)) : null
  const by = run.trigger === 'pipeline' ? 'pipeline' : 'editor'
  return `${formatDateWithTime(run.startedAt)} · ${by} · ${verdict ?? run.status} · $${run.costUsd.toFixed(3)}`
}

const isEmotionTag = (value: unknown): value is EmotionTag => EMOTION_TAGS.some(tag => tag === value)

/**
 * The story's single-source emotion tag: on a researched story the one its snapshot keeps, since an
 * apply gives the story research's tag; else its own (a single-source story's, or that of one
 * researched before research tagged its text, 2026-11-14, whose apply kept it).
 */
export function singleSourceEmotion(story: Pick<Story, 'emotionTag' | 'preResearch'>): EmotionTag | null {
  const kept = story.preResearch?.emotionTag
  if (kept === undefined) return story.emotionTag
  return isEmotionTag(kept) ? kept : null
}

/** This month's fallbacks by category, for the owner's count; the unrecorded ones (runs from before categories) only when there are any. */
function fallbackCounts(counts: NonNullable<ResearchUsage['fallbacksThisMonth']>): string {
  const named = FALLBACK_CATEGORIES.map(category => `${counts[category]} ${fallbackName(category)}`)
  return [...named, ...(counts.unrecorded > 0 ? [`${counts.unrecorded} unrecorded`] : [])].join(', ')
}

/**
 * The story's research section, the story page's Research tab: the month's spend against the cap,
 * the story's runs, the research step's among them, and which version the story shows
 * (`ResearchVersion.tsx`). A run starts from the page's action bar (`StoryActionBar`). Hidden
 * against a backend without research. An editor's run writes nothing to the story until an editor
 * uses its version; the research step applies its own verdicts.
 */
export function StoryResearch({ story }: { story: Pick<Story, 'id' | 'status' | 'emotionTag' | 'preResearch'> }) {
  const usage = useResearchUsage()
  const runs = useResearchRuns(story.id, usage.data != null)
  const [chosenId, setChosenId] = useState<string | null>(null)

  if (usage.isPending || usage.data === null) return null

  const list = runs.data ?? []
  const chosen = list.find(r => r.id === chosenId) ?? list[0]
  const selectId = `research-run-${story.id}`

  return (
    <section aria-labelledby={`research-${story.id}`} className={`${EDITOR_SECTION} space-y-3`}>
      <div>
        <h2 id={`research-${story.id}`} className={`${EDITOR_HEADING} mb-1`}>
          Research
        </h2>
        <p className="text-sm text-neutral-600">
          Admin only: a run you start changes nothing on the story until you use its version.
          {usage.data &&
            ` This month: ${money(usage.data.monthToDateUsd)} of ${money(usage.data.monthlyCapUsd)} spent; each run reserves ${money(usage.data.reservationUsd)} until it ends.`}
        </p>
        {usage.data?.fallbacksThisMonth && (
          <p className="text-sm text-neutral-600">Fallbacks to today&apos;s format this month: {fallbackCounts(usage.data.fallbacksThisMonth)}.</p>
        )}
      </div>
      {usage.isError && <p className="text-sm text-red-700">This month&apos;s research usage could not be loaded.</p>}
      <RevertToSingleSource story={story} />
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
          {/* An older backend sends no applyRefusal; it then answers an apply itself */}
          {canUseVersion(chosen) && <UseRunVersion story={story} run={chosen} closed={usage.data?.applyRefusal ?? null} />}
          <ResearchRunView run={chosen} singleSourceEmotion={singleSourceEmotion(story)} />
        </>
      )}
      {runs.isSuccess && list.length === 0 && <p className="text-sm text-neutral-500">No research runs yet.</p>}
    </section>
  )
}
