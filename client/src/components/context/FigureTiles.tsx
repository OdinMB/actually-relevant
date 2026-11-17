import type { ContextTilesView } from '@shared/types'
import { Citation, type SourcesById } from '../research/Citation'

/**
 * Big-number tiles (`.context/story-context.md`, "Tiles and charts"; `.context/public-website.md`,
 * "Story context"): per tile its value, or the values its sources disagree on, each with the chip of
 * the source that gives it, then what it counts. The server picks and formats the values
 * (`tileDisplay`) and leaves a label empty where it would repeat the card (`tileLabel`); a
 * provisional value says "estimate". A card says nothing twice: one tile sits flush in the card,
 * with no rail (several keep it, which tells them apart), and a single value names its source only
 * when the card cites more than one (`soleSource`: the footer already names it). `size` follows the
 * card: smaller in the margin.
 */
export function FigureTiles({
  tiles,
  sources,
  soleSource,
  size = 'large',
}: {
  tiles: ContextTilesView['tiles']
  sources: SourcesById
  /** The card cites one source, which its footer names. */
  soleSource: boolean
  size?: 'small' | 'large'
}) {
  const figure = size === 'small' ? 'text-2xl' : 'text-[1.75rem]'
  const rail = tiles.length > 1 ? 'border-l-[3px] border-neutral-200 py-0.5 pl-3' : ''
  return (
    <ul className="mb-3.5 grid gap-3">
      {tiles.map((tile, i) => {
        const several = tile.values.length > 1
        const label = [tile.label, several ? 'depending on whose count' : ''].filter(Boolean).join(', ')
        return (
          <li key={i} className={rail}>
            {tile.values.map(value => (
              <div key={value.sourceId + value.text} data-tile-value="" className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`font-nexa font-bold leading-tight text-neutral-900 ${figure}`}>{value.text}</span>
                {value.estimate && <span className="text-xs text-neutral-500">estimate</span>}
                {/* With several values each names its own source: that they differ is the point */}
                {several && <Citation citations={[{ sourceId: value.sourceId, sentence: null }]} sources={sources} />}
              </div>
            ))}
            {label && <div className="mt-0.5 text-[13px] leading-snug text-neutral-600">{label}</div>}
            {/* With one value the chip follows what it counts, as on the mockup, unless the footer names the card's one source */}
            {!several && !soleSource && (
              <div className="mt-1.5">
                <Citation citations={[{ sourceId: tile.values[0]!.sourceId, sentence: null }]} sources={sources} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
