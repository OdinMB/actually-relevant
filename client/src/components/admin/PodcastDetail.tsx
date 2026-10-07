import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Podcast, PodcastMode } from '@shared/types'
import { Badge } from '../ui/Badge'
import { formatDate } from '../../lib/constants'
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
import { AssignedStoriesList } from './AssignedStoriesList'
import { PodcastActionBar } from './PodcastActionBar'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { PodcastAudioTab } from './PodcastAudioTab'
import { PodcastHumanEditedChip } from './PodcastHumanEditedChip'
import { PodcastScriptTab, TextBlock } from './PodcastScriptTab'
import { PodcastStageBadge } from './PodcastStageBadge'
import { PodcastStageTabs } from './PodcastStageTabs'
import { PodcastStatusBadge } from './PodcastStatusBadge'
import { PodcastStoriesTab } from './PodcastStoriesTab'
import { PodcastTitle } from './PodcastTitle'
import { resolveTab } from './podcastTabs'
import type { PodcastTab } from './podcastTabs'

const MODE_LABEL: Record<PodcastMode, string> = { interactive: 'Interactive', automated: 'Fully automated' }

function StatusBadges({ podcast }: { podcast: Podcast }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PodcastStageBadge podcast={podcast} />
      <PodcastStatusBadge podcast={podcast} />
      {podcast.dryRun && <Badge variant="orange">Dry run</Badge>}
      {podcast.mode && <Badge variant="gray">{MODE_LABEL[podcast.mode]}</Badge>}
      {podcast.stage !== 'legacy' && <PodcastHumanEditedChip podcast={podcast} />}
      {podcast.kind === 'standalone' && <Badge variant="blue">Standalone</Badge>}
      {podcast.weekKey && <span className="text-sm text-neutral-600">{podcast.weekKey}</span>}
      {podcast.publishedAt && <span className="text-sm text-neutral-600">first published {formatDate(podcast.publishedAt)}</span>}
    </div>
  )
}

function Problems({ podcast }: { podcast: Podcast }) {
  return (
    <>
      {podcast.blockedAt && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Blocked since {formatDate(podcast.blockedAt)}</p>
          <p className="mt-1">{podcast.blockedReason}</p>
        </div>
      )}
      {/* A run that works again (Resume) is past the last failure: its box would read as current. */}
      {!podcast.blockedAt && !podcast.inProgress && podcast.lastError && (
        <div role="status" className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-semibold">Last run failed{podcast.failedAt ? ` on ${formatDate(podcast.failedAt)}` : ''}</p>
          <p className="mt-1">{podcast.lastError}</p>
        </div>
      )}
      {podcast.attempts > 0 && (
        <p className="text-sm text-neutral-600">Automatic attempts this week: {podcast.attempts}</p>
      )}
    </>
  )
}

/** The tab in the URL (`?tab=`), and moving to the running stage whenever a run starts. */
function useEpisodeTab(podcast: Podcast) {
  const [params, setParams] = useSearchParams()
  const tab = resolveTab(params.get('tab'), podcast)

  const setTab = useCallback((next: PodcastTab | null) => setParams(prev => {
    const updated = new URLSearchParams(prev)
    if (next) updated.set('tab', next)
    else updated.delete('tab')
    return updated
  }, { replace: true }), [setParams])

  // A run that starts (from any tab, the bar or another tab of the browser) shows its stage.
  const wasRunning = useRef(podcast.inProgress)
  useEffect(() => {
    if (podcast.inProgress && !wasRunning.current) setTab(null)
    wasRunning.current = podcast.inProgress
  }, [podcast.inProgress, setTab])

  return { tab, setTab }
}

/**
 * The episode page: the title as heading (pencil to edit), the status badges with the "edited by a
 * person" chip, problems and the live activity, then the stages as tabs (Stories, Script, Audio),
 * each a form with its own actions, and a bar fixed to the bottom with the player, Resume, Publish
 * and Delete. Unsaved edits in a tab hold a tab switch or leaving the page until confirmed.
 */
export function PodcastDetail({ podcast }: { podcast: Podcast }) {
  const [pendingEdits, setPendingEdits] = useState(false)
  const { tab, setTab } = useEpisodeTab(podcast)
  const leave = useUnsavedChangesGuard(pendingEdits)
  const legacy = podcast.stage === 'legacy'

  return (
    <div className="flex flex-1 flex-col">
      <div className="max-w-3xl flex-1 space-y-4">
        <header className="space-y-2">
          <PodcastTitle podcast={podcast} />
          <StatusBadges podcast={podcast} />
        </header>

        <Problems podcast={podcast} />

        {legacy ? (
          <>
            <AssignedStoriesList label="Assigned stories" storyIds={podcast.storyIds} />
            <TextBlock title="Script (legacy, read-only)" text={podcast.script} empty="No script." />
          </>
        ) : (
          <>
            <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-neutral-700">
              {podcast.inProgress ? `${podcast.activity ?? 'Working'}… This runs on the server; you can leave this page.` : ''}
            </p>
            <PodcastStageTabs
              podcast={podcast}
              selected={tab}
              onSelect={next => { if (next !== tab) leave.guard(() => setTab(next)) }}
              panels={{
                stories: <PodcastStoriesTab podcast={podcast} pendingEdits={pendingEdits} onDirtyChange={setPendingEdits} />,
                script: <PodcastScriptTab podcast={podcast} pendingEdits={pendingEdits} onDirtyChange={setPendingEdits} />,
                audio: <PodcastAudioTab podcast={podcast} pendingEdits={pendingEdits} onBackToScript={() => setTab('script')} />,
              }}
            />
          </>
        )}
      </div>

      <PodcastActionBar podcast={podcast} pendingEdits={pendingEdits} />

      <UnsavedChangesDialog leave={leave} description="The changes in this tab have not been saved. Leaving discards them." />
    </div>
  )
}
