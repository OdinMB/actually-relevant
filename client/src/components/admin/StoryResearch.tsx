import { useState } from 'react'
import type {
  EmotionTag,
  PassUsage,
  ResearchFallbackCategory,
  ResearchPass,
  ResearchRun,
  ResearchUsage,
  Story,
  StoryPasses as StoryPassesView,
} from '@shared/types'
import { EMOTION_TAGS } from '@shared/constants'
import { Select } from '../ui/Select'
import { useResearchRuns, useResearchUsage } from '../../hooks/useResearch'
import { usePasses, usePassUsage } from '../../hooks/useResearchPass'
import { formatDateWithTime } from '../../lib/constants'
import { ArticleVersions, EvidencePoolView, passLabel, ResearchPassView } from './ResearchPassView'
import { fallbackName, ResearchRunView, verdictLabel, verdictName } from './ResearchRunView'
import { canUseVersion, RevertToSingleSource, UndoUpdate, UseRunVersion } from './ResearchVersion'
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

type ResearchStory = Pick<Story, 'id' | 'status' | 'emotionTag' | 'preResearch'>

/**
 * The story's research section, the story page's Research tab. While research passes are on, or
 * once the story has a pass or a version, it is the passes' (`StoryPasses`); else research's runs as
 * before passes (`RunsSection`).
 */
export function StoryResearch({ story }: { story: ResearchStory }) {
  const passUsage = usePassUsage()
  const passes = usePasses(story.id)
  const usage = useResearchUsage()
  const view = passes.data
  const on = passUsage.data?.on === true
  if (passUsage.isPending) return null
  if (on || (view && (view.passes.length > 0 || view.versions.length > 0))) return <StoryPasses story={story} usage={passUsage.data ?? null} view={view} />
  return <RunsSection story={story} usage={usage} />
}

/** A pass or a legacy run, as the picker holds it. */
type Chosen = { kind: 'pass'; pass: ResearchPass } | { kind: 'run'; run: ResearchRun }

/**
 * The tab once passes are on (`.context/research-passes.md`): that a pass applies itself and what
 * it reserves, the version controls (Revert to single-source, Undo this update), the passes newest
 * first and then the story's research runs from before passes, read only, the chosen one shown, and
 * the story's versions and evidence pool. A pass starts from the page's action bar ("Research again").
 */
function StoryPasses({ story, usage, view }: { story: ResearchStory; usage: PassUsage | null; view: StoryPassesView | null | undefined }) {
  const [chosenId, setChosenId] = useState<string | null>(null)
  const options: Chosen[] = [
    ...(view?.passes ?? []).map(pass => ({ kind: 'pass' as const, pass })),
    ...(view?.legacyRuns ?? []).map(run => ({ kind: 'run' as const, run })),
  ]
  const idOf = (c: Chosen) => (c.kind === 'pass' ? `pass:${c.pass.id}` : `run:${c.run.id}`)
  const chosen = options.find(c => idOf(c) === chosenId) ?? options[0]
  const emotion = singleSourceEmotion(story)

  return (
    <section aria-labelledby={`research-${story.id}`} className={`${EDITOR_SECTION} space-y-3`}>
      <div>
        <h2 id={`research-${story.id}`} className={`${EDITOR_HEADING} mb-1`}>
          Research
        </h2>
        <p className="text-sm text-neutral-600">
          A research pass applies its own result: a first pass gives the story its researched version, and a later one rewrites only the sections that facts
          found since make wrong or substantially different, with an Update readers see.
          {usage &&
            ` This month: ${money(usage.spentUsd)} of ${money(usage.capUsd)} spent; a first pass reserves ${money(usage.firstPassUsd)} and a later one ${money(usage.laterPassUsd)} until it ends.`}
        </p>
        {/* Why "Research again" is closed now, whatever the story: the cap reached, the key unset, the step switched off */}
        {usage?.refusal && <p className="text-sm text-neutral-600">{usage.refusal}.</p>}
      </div>
      <RevertToSingleSource story={story} />
      {view && <UndoUpdate story={story} versions={view.versions} />}
      {view === undefined && <p className="text-sm text-neutral-500">Loading the story&apos;s passes…</p>}
      {view && chosen && (
        <>
          <Select
            id={`research-pass-${story.id}`}
            label="Pass or run"
            value={idOf(chosen)}
            onChange={e => setChosenId(e.target.value)}
            options={options.map(c => ({ value: idOf(c), label: c.kind === 'pass' ? passLabel(c.pass) : `Research run · ${runLabel(c.run)}` }))}
          />
          {chosen.kind === 'pass' ? (
            <ResearchPassView pass={chosen.pass} view={view} singleSourceEmotion={emotion} />
          ) : (
            <ResearchRunView run={chosen.run} singleSourceEmotion={emotion} />
          )}
        </>
      )}
      {view && options.length === 0 && <p className="text-sm text-neutral-500">No research passes yet.</p>}
      {view && <ArticleVersions versions={view.versions} />}
      {view && <EvidencePoolView view={view} />}
    </section>
  )
}

/**
 * Research's tab as before passes: the month's spend against the cap, the story's runs, the research
 * step's among them, and which version the story shows (`ResearchVersion.tsx`). A run starts from
 * the page's action bar (`StoryActionBar`). Hidden against a backend without research. An editor's
 * run writes nothing to the story until an editor uses its version; the research step applies its
 * own verdicts.
 */
function RunsSection({ story, usage }: { story: ResearchStory; usage: ReturnType<typeof useResearchUsage> }) {
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
