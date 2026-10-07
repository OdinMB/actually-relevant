import type { Podcast } from '@shared/types'
import { Tooltip } from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { useUpdatePodcast } from '../../hooks/usePodcasts'

/**
 * "Edited by a person" as a toggle chip beside the status badges. The server ticks it when a person
 * changes the stories or the script; a person can change it at any time, also after publication (it
 * only picks the AI line). What it means is in a tooltip, on hover and on keyboard focus.
 */
export function PodcastHumanEditedChip({ podcast }: { podcast: Podcast }) {
  const update = useUpdatePodcast()
  const { toast } = useToast()
  const disabled = podcast.inProgress || update.isPending
  const on = podcast.humanEdited

  return (
    <Tooltip
      content={
        <>
          Ticked automatically when someone changes the stories or the script; you can change it at any time, also after publishing.
          It picks the AI line of the show notes, the podcast feed and the podcast page:{' '}
          on, it adds that a person reviewed and edited the episode; off, it is the standard AI line.
          {on ? ' It is on now.' : ' It is off now.'}
          {podcast.inProgress && ' It can be changed once the current run finishes.'}
        </>
      }
    >
      {trigger => (
        <label
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium focus-within:ring-2 focus-within:ring-brand-500 ${
            on ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-neutral-300 bg-white text-neutral-700'
          } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={on}
            disabled={disabled}
            onChange={e => update.mutate({ id: podcast.id, data: { humanEdited: e.target.checked } }, {
              onError: err => toast('error', err instanceof Error ? err.message : 'Failed to update'),
            })}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-brand-600 focus:ring-0 focus-visible:outline-none"
            {...trigger}
          />
          Edited by a person
        </label>
      )}
    </Tooltip>
  )
}
