import { usePositivity } from '../contexts/PositivityContext'
import { FOCUS_RING } from '../lib/control-classes'

const LABELS: Record<number, string> = {
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
  const current = LABELS[positivity] ?? 'Balanced mix'

  return (
    <div className={`flex flex-col items-center gap-1 ${className ?? ''}`}>
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
          aria-label="Mix of news, from heavy to uplifting"
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
