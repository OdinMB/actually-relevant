import type { ContextTilesView } from '@shared/types'
import { Citation, type SourcesById } from '../research/Citation'

/**
 * Big-number tiles (`.context/story-context.md`, "Tiles and charts"): per tile its value, or the
 * values its sources disagree on, each with the chip of the source that gives it, then what it
 * counts. The server picks and formats the values (`tileDisplay`); a provisional one says
 * "estimate". `size` follows the card: smaller in the margin.
 */
export function FigureTiles({ tiles, sources, size = 'large' }: { tiles: ContextTilesView['tiles']; sources: SourcesById; size?: 'small' | 'large' }) {
  const figure = size === 'small' ? 'text-2xl' : 'text-[1.75rem]'
  return (
    <ul className="mb-3.5 grid gap-3">
      {tiles.map((tile, i) => (
        <li key={i} className="border-l-[3px] border-neutral-200 py-0.5 pl-3">
          {tile.values.map(value => (
            <div key={value.sourceId + value.text} data-tile-value="" className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`font-nexa font-bold leading-tight text-neutral-900 ${figure}`}>{value.text}</span>
              {value.estimate && <span className="text-xs text-neutral-500">estimate</span>}
              {/* With one value the chip follows what it counts, as on the mockup; with several, each value names its own */}
              {tile.values.length > 1 && <Citation citations={[{ sourceId: value.sourceId, sentence: null }]} sources={sources} />}
            </div>
          ))}
          <div className="mt-0.5 text-[13px] leading-snug text-neutral-600">
            {tile.label}
            {tile.values.length > 1 && ', depending on whose count'}
          </div>
          {tile.values.length === 1 && (
            <div className="mt-1.5">
              <Citation citations={[{ sourceId: tile.values[0]!.sourceId, sentence: null }]} sources={sources} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
