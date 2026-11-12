import { usePositivity } from '../contexts/PositivityContext'
import { FOCUS_RING } from '../lib/control-classes'

export const MIX_LABELS: Record<number, string> = {
  0: 'Only heavy news',
  25: 'Mostly heavy',
  50: 'Balanced mix',
  75: 'Mostly uplifting',
  100: 'Only uplifting',
}

/**
 * Compact mood dial: the current mix ("Mix of news: Balanced mix") above an emoji slider,
 * so the label says what the slider does and updates as it moves.
 * Used directly in both mobile menu and desktop header.
 */
export function MoodDialPanel({ className }: { className?: string }) {
  const { positivity, setPositivity } = usePositivity()
  return <MoodDial value={positivity} onChange={setPositivity} className={className} />
}

/** The dial itself, for a value its caller holds: the site setting above, a widget's own mix on /widgets. */
export function MoodDial({
  value: positivity,
  onChange: setPositivity,
  label = 'Mix of news, from heavy to uplifting',
  align = 'center',
  className,
}: {
  align?: 'center' | 'start'
  value: number
  onChange: (value: number) => void
  /** The slider's accessible name; a second dial on a page needs its own */
  label?: string
  className?: string
}) {
  const current = MIX_LABELS[positivity] ?? 'Balanced mix'

  return (
    <div className={`flex flex-col ${align === 'start' ? 'items-start' : 'items-center'} gap-1 ${className ?? ''}`}>
      {/* Hidden from screen readers: the slider announces the same text as its name and value */}
      <span className="text-[10px] text-neutral-500 leading-none select-none" aria-hidden="true">
        Mix of news: <span className="font-medium text-neutral-700">{current}</span>
      </span>

      <div className="flex items-center gap-2">
        <span className="text-sm select-none shrink-0 leading-none" aria-hidden="true">
          😰
        </span>

        <input
          type="range"
          min={0}
          max={100}
          step={25}
          value={positivity}
          onChange={e => setPositivity(parseInt(e.target.value, 10))}
          className={`positivity-slider w-40 lg:w-32 h-2 appearance-none bg-neutral-200 rounded-full cursor-pointer ${FOCUS_RING} focus-visible:ring-offset-2`}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={positivity}
          aria-valuetext={current}
        />

        <span className="text-sm select-none shrink-0 leading-none" aria-hidden="true">
          😊
        </span>
      </div>
    </div>
  )
}
