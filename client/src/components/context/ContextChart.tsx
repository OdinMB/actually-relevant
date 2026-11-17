import { useId, type ReactNode } from 'react'
import type { ContextChartPointView, ContextChartView } from '@shared/types'
import { shiftHex, type CategoryColor } from '../../lib/category-colors'
import type { SourcesById } from '../research/Citation'
import { outletName } from '../research/sourceText'
import { asOfText, chartCaption } from './contextText'

/**
 * A context card's chart (`.context/story-context.md`, "Tiles and charts"; the server has already
 * applied the chart rules): comparison bars or a line over time, as SVG from zero. A point within 30
 * days of the story's day takes the area's color, the others are neutral; a provisional point is
 * hatched; an `apart` group, a different measure, is drawn lighter under its own label. The visible
 * caption names the drawing (`role="img"`), a source line follows it, and a visually hidden table
 * gives every value with its date and source. No mark is a focus stop.
 */

const NEUTRAL = '#a3a3a3'
const AXIS = '#d4d4d4'
const APART_LABEL = 'A different measure: shown, not compared'

/** Rough text widths at the chart's sizes, for laying out labels without measuring. */
const textWidth = (text: string, px: number) => Math.ceil(text.length * px * 0.55)

interface Fill {
  fill: string
  /** The hatch pattern, for a provisional mark. */
  pattern: ReactNode
  stroke?: string
}

/** A mark's fill: its color, or for a provisional point a hatch of it (a pattern of its own). */
function markFill(color: string, provisional: boolean, id: string): Fill {
  if (!provisional) return { fill: color, pattern: null }
  const dark = shiftHex(color, -0.2)
  return {
    fill: `url(#${id})`,
    stroke: dark,
    pattern: (
      <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill={shiftHex(color, 0.7)} />
        <line x1="0" y1="0" x2="0" y2="7" stroke={dark} strokeWidth="3" />
      </pattern>
    ),
  }
}

const pointColor = (p: ContextChartPointView, colors: CategoryColor) => (p.recent ? colors.hex : NEUTRAL)

/** What a chart kind draws, and how tall it came out in a view box `width` wide. */
interface Drawing {
  marks: ReactNode
  height: number
}

function drawBars(chart: ContextChartView, colors: CategoryColor, uid: string, viewWidth: number): Drawing {
  const apart = chart.apart && chart.apart.points.length > 0 ? chart.apart : null
  const all = [...chart.points, ...(apart?.points ?? [])]
  const longest = Math.max(...all.map(p => p.label.length))
  // Short labels (years, places) sit left of the bars, as on the mockup; longer ones above them
  const labelsLeft = longest <= 14
  const labelWidth = labelsLeft ? textWidth('x'.repeat(longest), 12) + 8 : 0
  const valueWidth = Math.max(...all.map(p => textWidth(p.text, 13))) + 10
  const barSpace = viewWidth - labelWidth - valueWidth
  // A different measure in the same unit keeps the scale, so the bars don't mislead; in another unit it has its own
  const sameUnit = apart?.unit === chart.unit
  const max = (points: ContextChartPointView[]) => Math.max(...points.map(p => p.value), 0) || 1
  const mainMax = max(sameUnit && apart ? all : chart.points)
  const apartMax = sameUnit ? mainMax : max(apart?.points ?? [])

  const patterns: ReactNode[] = []
  const marks: ReactNode[] = []
  let y = 0
  const row = (p: ContextChartPointView, scaleMax: number, color: string, key: string) => {
    const top = labelsLeft ? y : y + 17
    const width = (p.value / scaleMax) * barSpace
    const { fill, pattern, stroke } = markFill(color, p.provisional, `${uid}-${key}`)
    if (pattern) patterns.push(<g key={key}>{pattern}</g>)
    const valueX = labelWidth + width + 6
    marks.push(
      <g key={key}>
        <text x={0} y={labelsLeft ? top + 14 : top - 5} fontSize="12" fill="#525252">
          {p.label}
        </text>
        <rect x={labelWidth} y={top} width={Math.max(width, 1)} height={20} rx={4} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : undefined} />
        <text x={valueX} y={top + 14} fontSize="13" fontWeight="700" fill="#171717">
          {p.text}
        </text>
        {p.provisional && (
          <text x={valueX} y={top + 28} fontSize="11" fill="#737373">
            estimate
          </text>
        )}
      </g>,
    )
    y = top + 20 + (p.provisional ? 16 : 12)
  }

  chart.points.forEach((p, i) => row(p, mainMax, pointColor(p, colors), `p${i}`))
  const axisEnd = y - 8
  if (apart) {
    const tint = shiftHex(colors.hex, 0.55)
    y += 6
    marks.push(<line key="rule" x1={0} y1={y} x2={viewWidth} y2={y} stroke="#e5e5e5" strokeDasharray="4 3" />)
    marks.push(
      <text key="apart" x={0} y={y + 18} fontSize="11" fill="#737373">
        {APART_LABEL}
      </text>,
    )
    y += 28
    apart.points.forEach((p, i) => row(p, apartMax, tint, `a${i}`))
    marks.push(
      <text key="apart-caption" x={labelWidth} y={y + 2} fontSize="11" fill="#737373">
        {apart.caption}
      </text>,
    )
    y += 10
  }

  return {
    marks: (
      <>
        {patterns.length > 0 && <defs>{patterns}</defs>}
        {labelsLeft && <line x1={labelWidth} y1={0} x2={labelWidth} y2={axisEnd} stroke={AXIS} />}
        {marks}
      </>
    ),
    height: y,
  }
}

/** The start of a fact's period, for placing a point in time. */
const periodStart = (asOf: string): number => {
  const [year, month = '1', day = '1'] = asOf.split('-')
  return Date.UTC(Number(year), Number(month) - 1, Number(day))
}

/** A label cut into at most two lines of about `chars` characters, the second ending in "…" when it goes on. */
function wrapLabel(label: string, chars: number): string[] {
  const lines: string[] = ['']
  for (const word of label.split(/\s+/)) {
    const last = lines[lines.length - 1]!
    if (last && `${last} ${word}`.length > chars) lines.push(word)
    else lines[lines.length - 1] = last ? `${last} ${word}` : word
  }
  return lines.length > 2 ? [lines[0]!, `${lines[1]!}…`] : lines
}

const LINE_TOP = 22
// The scale starts at zero, so close values sit high on the plot; a short plot keeps the empty band small
const LINE_BOTTOM = 92
const LINE_PAD = 22

function drawLine(chart: ContextChartView, colors: CategoryColor, uid: string, viewWidth: number): Drawing {
  const points = chart.points
  const dated = points.every(p => p.asOf)
  const times = points.map((p, i) => (dated ? periodStart(p.asOf!) : i))
  const [first, last] = [Math.min(...times), Math.max(...times)]
  const xs = times.map(t => LINE_PAD + ((t - first) / (last - first || 1)) * (viewWidth - 2 * LINE_PAD))
  const max = Math.max(...points.map(p => p.value), 0) || 1
  const ys = points.map(p => LINE_BOTTOM - (p.value / max) * (LINE_BOTTOM - LINE_TOP))
  const spacing = Math.min(...xs.slice(1).map((x, i) => x - xs[i]!))
  const chars = Math.max(6, Math.floor(spacing / 6.2))
  const anchor = (i: number) => (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle')
  const edge = (i: number) => (i === 0 ? -6 : i === points.length - 1 ? 6 : 0)

  const patterns: ReactNode[] = []
  const dots = points.map((p, i) => {
    const { fill, pattern, stroke } = markFill(p.recent ? colors.hex : '#737373', p.provisional, `${uid}-p${i}`)
    if (pattern) patterns.push(<g key={i}>{pattern}</g>)
    return <circle key={i} cx={xs[i]} cy={ys[i]} r={p.provisional ? 5.5 : 4.5} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.5 : undefined} />
  })

  const marks = (
    <>
      {patterns.length > 0 && <defs>{patterns}</defs>}
      <line x1={0} y1={LINE_BOTTOM} x2={viewWidth} y2={LINE_BOTTOM} stroke={AXIS} />
      <text x={0} y={LINE_BOTTOM - 4} fontSize="11" fill="#737373">
        0
      </text>
      {/* The segment into a provisional point is dashed */}
      {points.slice(1).map((p, i) => (
        <line
          key={i}
          x1={xs[i]}
          y1={ys[i]}
          x2={xs[i + 1]}
          y2={ys[i + 1]}
          stroke={NEUTRAL}
          strokeWidth="2"
          strokeDasharray={p.provisional ? '4 3' : undefined}
        />
      ))}
      {dots}
      {points.map((p, i) => (
        <g key={i} fontSize="12" fill="#525252" textAnchor={anchor(i)}>
          <text x={xs[i]! + edge(i)} y={ys[i]! - 10} fontSize="13" fontWeight="700" fill="#171717">
            {p.text}
          </text>
          {wrapLabel(p.label, chars).map((text, line) => (
            <text key={line} x={xs[i]! + edge(i)} y={LINE_BOTTOM + 16 + line * 13}>
              {text}
            </text>
          ))}
        </g>
      ))}
    </>
  )
  return { marks, height: LINE_BOTTOM + 34 }
}

interface ContextChartProps {
  chart: ContextChartView
  sources: SourcesById
  colors: CategoryColor
  /** The drawing's width in px: the text draws at its size there, and the chart never grows past it. */
  width?: number
}

export function ContextChart({ chart, sources, colors, width = 300 }: ContextChartProps) {
  const uid = useId().replace(/:/g, '')
  const captionId = `${uid}-caption`
  const caption = chartCaption(chart)
  const name = (sourceId: string) => {
    const source = sources.get(sourceId)
    return source ? outletName(source) : ''
  }
  const drawing = chart.kind === 'bars' ? drawBars(chart, colors, uid, width) : drawLine(chart, colors, uid, width)
  const apart = chart.apart && chart.apart.points.length > 0 ? chart.apart : null
  const outlets = [...new Set([...chart.points, ...(apart?.points ?? [])].map(p => name(p.sourceId)).filter(Boolean))]
  const row = (p: ContextChartPointView, i: number) => (
    <tr key={i}>
      <th scope="row">{p.label}</th>
      <td>
        {p.text}
        {p.provisional && ', estimate'}
      </td>
      <td>{asOfText(p.asOf) ?? ''}</td>
      <td>{name(p.sourceId)}</td>
    </tr>
  )

  return (
    <figure className="mb-3.5">
      <figcaption id={captionId} className="mb-2 text-xs leading-4 text-neutral-500">
        {caption}
      </figcaption>
      <svg
        role="img"
        aria-labelledby={captionId}
        viewBox={`0 0 ${width} ${drawing.height}`}
        className="block h-auto w-full overflow-visible font-roboto"
        style={{ maxWidth: width }}
      >
        {drawing.marks}
      </svg>
      {outlets.length > 0 && (
        <div className="mt-1.5 text-xs leading-4 text-neutral-500">
          {outlets.length === 1 ? 'Source' : 'Sources'}: {outlets.join(', ')}
        </div>
      )}
      {/* A table is sized to its content whatever its width says, so the 1px box is a wrapper */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">Value</th>
              <th scope="col">As of</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>{chart.points.map(row)}</tbody>
          {apart && (
            <tbody>
              <tr>
                <th scope="rowgroup" colSpan={4}>
                  {APART_LABEL}: {apart.caption}
                </th>
              </tr>
              {apart.points.map(row)}
            </tbody>
          )}
        </table>
      </div>
    </figure>
  )
}
