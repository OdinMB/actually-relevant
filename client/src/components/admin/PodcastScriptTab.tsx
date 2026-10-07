import type { Podcast } from '@shared/types'
import { PodcastScriptEditor } from './PodcastScriptEditor'
import { atRestAndChangeable } from './podcastRun'

export function TextBlock({ title, text, empty }: { title: string; text: string; empty: string }) {
  return (
    <section className="bg-white rounded-lg border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="text-sm text-neutral-700 whitespace-pre-wrap max-h-[32rem] overflow-y-auto">
        {text || <span className="text-neutral-500 italic">{empty}</span>}
      </div>
    </section>
  )
}

interface PodcastScriptTabProps {
  podcast: Podcast
  onDirtyChange: (dirty: boolean) => void
}

/**
 * The Script stage: the editor at `scripted` while it can still change (Save script, Regenerate
 * script, Approve and voice), otherwise the script read-only; the show notes below either way.
 */
export function PodcastScriptTab({ podcast, onDirtyChange }: PodcastScriptTabProps) {
  const editable = podcast.stage === 'scripted' && atRestAndChangeable(podcast) && !!podcast.dialogue
  const writing = podcast.inProgress && podcast.stage === 'selected'
  return (
    <div className="space-y-4">
      {editable
        ? <PodcastScriptEditor podcast={podcast} onDirtyChange={onDirtyChange} />
        : <TextBlock title="Script" text={podcast.script} empty={writing ? 'The script is being written.' : 'No script yet.'} />}
      <TextBlock title="Show notes" text={podcast.showNotes} empty="No show notes yet." />
    </div>
  )
}
