import { useEffect, useState } from 'react'
import type { Podcast, PodcastDialogue, PodcastScriptEdit } from '@shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Textarea } from '../ui/Textarea'
import { useToast } from '../ui/Toast'
import { ApiError } from '../../lib/admin-api'
import { useRewindPodcast, useSavePodcastScript } from '../../hooks/usePodcasts'
import { PodcastRunButton } from './PodcastRunButton'

const SPEAKER_LABEL = { HOST_A: 'Host A', HOST_B: 'Host B' } as const

/** The stored dialogue with the edited turn texts and summary, structure unchanged (speakers stay). */
export function buildScriptEdit(dialogue: PodcastDialogue, texts: string[][], summary: string): PodcastScriptEdit {
  return {
    episodeSummary: summary,
    segments: dialogue.segments.map((segment, i) => ({
      ...segment,
      turns: segment.turns.map((turn, j) => ({ speaker: turn.speaker, text: texts[i]?.[j] ?? turn.text })),
    })),
  }
}

const textsOf = (dialogue: PodcastDialogue) => dialogue.segments.map(s => s.turns.map(t => t.text))

interface Feedback {
  errors: string[]
  warnings: string[]
}

interface PodcastScriptEditorProps {
  podcast: Podcast
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Editing the script at `scripted`: the text of each turn under its fixed speaker, and the
 * summary. A save is validated on the server: errors block it (nothing saved), segue warnings are
 * shown and may stay. Also Regenerate script, which discards it, and at a review stop Approve and
 * voice (waits until the edits are saved or discarded; asks for the cost first).
 */
export function PodcastScriptEditor({ podcast, onDirtyChange }: PodcastScriptEditorProps) {
  const dialogue = podcast.dialogue
  const save = useSavePodcastScript()
  const rewind = useRewindPodcast()
  const { toast } = useToast()
  const [texts, setTexts] = useState<string[][]>(() => (dialogue ? textsOf(dialogue) : []))
  const [summary, setSummary] = useState(dialogue?.episodeSummary ?? '')
  const [feedback, setFeedback] = useState<Feedback>({ errors: [], warnings: [] })
  const [confirming, setConfirming] = useState(false)

  // When the stored script changes (a save, or a new script), the fields follow it; a refetch of
  // the same script leaves unsaved edits alone, and the save's warnings stay visible.
  const storedKey = JSON.stringify(dialogue)
  const [shownKey, setShownKey] = useState(storedKey)
  if (dialogue && storedKey !== shownKey) {
    setShownKey(storedKey)
    setTexts(textsOf(dialogue))
    setSummary(dialogue.episodeSummary)
  }

  const dirty = !!dialogue && (summary !== dialogue.episodeSummary || textsOf(dialogue).some((seg, i) => seg.some((t, j) => t !== texts[i]?.[j])))
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  if (!dialogue) return null
  const titleFor = (ref: number | null) => podcast.episodeStories?.find(s => s.ref === ref)?.title

  const handleSave = () => {
    setFeedback({ errors: [], warnings: [] })
    save.mutate({ id: podcast.id, edit: buildScriptEdit(dialogue, texts, summary) }, {
      onSuccess: ({ warnings }) => {
        setFeedback({ errors: [], warnings })
        toast('success', warnings.length > 0 ? 'Script saved, with warnings' : 'Script saved')
      },
      onError: err => {
        const body = err instanceof ApiError ? (err.body as Partial<Feedback> | undefined) : undefined
        setFeedback({ errors: body?.errors ?? [err instanceof Error ? err.message : 'Failed to save the script'], warnings: body?.warnings ?? [] })
      },
    })
  }

  const handleRegenerate = () => {
    rewind.mutate({ id: podcast.id, to: 'selected', advance: true }, {
      onError: err => toast('error', err instanceof Error ? err.message : 'Failed'),
      onSettled: () => setConfirming(false),
    })
  }

  const setTurn = (i: number, j: number, value: string) => setTexts(prev => prev.map((seg, a) => (a === i ? seg.map((t, b) => (b === j ? value : t)) : seg)))

  return (
    <section aria-labelledby="podcast-script-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4">
      <div>
        <h3 id="podcast-script-heading" className="text-sm font-semibold text-neutral-900">Script</h3>
        <p className="text-xs text-neutral-600 mt-1">
          Edit what each host says; who speaks stays as written. The spoken AI disclosure at the start and the sign-off are added automatically.
        </p>
      </div>

      <Textarea id="podcast-summary" label="Episode summary" rows={2} value={summary} onChange={e => setSummary(e.target.value)} />

      {dialogue.segments.map((segment, i) => (
        <fieldset key={i} className="space-y-3 border-t border-neutral-100 pt-3">
          <legend className="text-sm font-medium text-neutral-800">
            {segment.kind === 'intro' ? 'Intro' : segment.kind === 'outro' ? 'Outro' : `Story ${segment.storyRef}: ${titleFor(segment.storyRef) ?? ''}`}
          </legend>
          {segment.turns.map((turn, j) => (
            <Textarea
              key={j}
              id={`turn-${i}-${j}`}
              label={SPEAKER_LABEL[turn.speaker]}
              rows={Math.min(8, Math.max(2, Math.ceil((texts[i]?.[j]?.length ?? 0) / 90)))}
              value={texts[i]?.[j] ?? ''}
              onChange={e => setTurn(i, j, e.target.value)}
            />
          ))}
        </fieldset>
      ))}

      {feedback.errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Not saved. Fix these first:</p>
          <ul className="list-disc pl-5 mt-1">{feedback.errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {feedback.warnings.length > 0 && (
        <div role="status" className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          <p className="font-semibold">Worth a look (does not block):</p>
          <ul className="list-disc pl-5 mt-1">{feedback.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {/* Always shown (disabled while nothing changed), so the form does not shift when an edit starts */}
      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
        <Button size="sm" variant="secondary" onClick={handleSave} loading={save.isPending} disabled={!dirty}>Save script</Button>
        <Button size="sm" variant="ghost" onClick={() => { setTexts(textsOf(dialogue)); setSummary(dialogue.episodeSummary); setFeedback({ errors: [], warnings: [] }) }} disabled={!dirty || save.isPending}>
          Discard changes
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={save.isPending || rewind.isPending}>Regenerate script</Button>
        {podcast.awaitingReview && (
          <span className="sm:ml-auto">
            <PodcastRunButton podcast={podcast} size="sm" confirmTitle="Approve the script and voice it?" disabled={dirty}>Approve and voice</PodcastRunButton>
          </span>
        )}
      </div>
      {podcast.awaitingReview && (
        <p className="min-h-[1rem] text-xs text-neutral-600">{dirty ? 'Save or discard your changes before approving.' : ''}</p>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleRegenerate}
        title="Write a new script?"
        description="This script and your edits are discarded and a new one is written for the same stories. It then waits for your review."
        variant="danger"
        confirmLabel="Regenerate script"
        loading={rewind.isPending}
      />
    </section>
  )
}
