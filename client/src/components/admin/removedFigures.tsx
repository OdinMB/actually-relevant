import type { ContextRunRecord } from '@shared/types'

/**
 * How a figure the figure check removed is shown, in a context run's "What the run did" and a
 * research pass's Facts alike: the fact's ref, the figure as written, what it was said to count, and
 * why it went. The fact itself stays.
 */

export type RemovedFigure = NonNullable<ContextRunRecord['removedFigures']>[number]

/** Why the figure went, by the check's answer. */
export const REMOVED_FIGURE_REASONS: Record<RemovedFigure['answer'], string> = {
  computed: 'worked out, not stated by the source',
  'other-thing': 'the source gives this number for something else',
  'not-stated': 'the source does not state this number',
  'no-answer': 'the check gave no answer',
}

/** The removed figure's line: its fact's ref, the figure as written, and what it counted when that was said. */
export function RemovedFigureText({ figure }: { figure: RemovedFigure }) {
  return (
    <>
      <span className="font-mono text-xs text-neutral-500">{figure.ref}</span> “{figure.figure}”{figure.counted ? ` (${figure.counted})` : null}
    </>
  )
}
