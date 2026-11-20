/**
 * The overview linking steps' report sections (`link.ts`): what was replayed, then the bars of each
 * step that ran (`link`, `found`, `role`) and the runs' details. Pure.
 */
import type { OverviewStep } from '../options.js'
import { cell, usd } from './reportText.js'
import type { LinkStepReport } from './link.js'
import type { Bar } from './linkScore.js'

const value = (b: Bar) => (b.value === null ? 'n/a' : b.direction === 'atMost' ? b.value.toFixed(2) : `${(b.value * 100).toFixed(1)}%`)
const target = (b: Bar) => (b.direction === 'atMost' ? `at most ${b.target}` : `at least ${Math.round(b.target * 100)}%`)
/** A bar's verdict in words: met, not met, for the owner to read (too few judgments), or no data. */
export const verdict = (b: Bar) => (b.forOwner ? `for the owner: ${b.forOwner}` : b.met === null ? 'no data' : b.met ? 'met' : 'not met')
/** One table row per bar: its name, target, mean and verdict. */
export const rows = (bars: Bar[]) => bars.map(b => `| ${b.name} | ${target(b)} | ${value(b)} | ${verdict(b)} |`)

/** How often the link calls flagged the re-center signals, per run: no bars, for the owner. */
function signalLines(r: LinkStepReport): string[] {
  if (r.signals.length === 0) return []
  return [
    '### Re-center signals (no bars; for the owner)',
    '',
    "A center entry flagged for its development's overview is the signal's recall; the share of near misses flagged wider sets how often attempts fire, and so their cost; a center-moved flag on a development whose key has no center is a false shift.",
    '',
    '| Run | Center entries flagged | Near misses flagged wider | False shifts |',
    '|---|---|---|---|',
    ...r.signals.map(
      s =>
        `| ${s.run} | ${s.centerFlagged} of ${s.centerEntries} | ${s.nearMissesWider} of ${s.nearMisses} | ${s.falseShifts.length}${s.falseShifts.length > 0 ? `: ${s.falseShifts.join(', ')}` : ''} |`,
    ),
    '',
  ]
}

export function linkLines(r: LinkStepReport, steps: readonly OverviewStep[]): string[] {
  const shown = (step: OverviewStep) => steps.includes(step)
  return [
    `**Replay:** ${r.stories} stories (entries and near misses) of ${r.keys.length} answer keys (half ${r.half}: ${r.keys.join(', ') || 'none'}${r.limit !== undefined ? `; the first ${r.limit} stories only, a smoke run, not evidence` : ''}), ${r.repeat} run${r.repeat === 1 ? '' : 's'} through production's linking against the in-memory sandbox, oldest first. Model spend ${usd(r.costUsd)}${r.perStoryUsd !== null ? `, ${usd(r.perStoryUsd)} a story` : ''}.`,
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
    '',
    '| Measure | Bar | Mean | Verdict |',
    '|---|---|---|---|',
    ...(shown('link') ? rows(r.score.link) : []),
    ...(shown('found') ? rows(r.score.found) : []),
    ...(shown('role') ? rows(r.score.role) : []),
    '',
    '### Per run',
    '',
    '| Run | Joins right / wrong | Must entries found | Overviews founded / wrong | Roles agreeing |',
    '|---|---|---|---|---|',
    ...r.score.runs.map(
      s => `| ${s.run} | ${s.right} / ${s.wrong} | ${s.found} of ${s.must} | ${s.foundings} / ${s.wrongFoundings} | ${s.rolesAgreeing} of ${s.rolesJudged} |`,
    ),
    '',
    ...(shown('found') && r.endEvents.length > 0
      ? [
          '### End events',
          '',
          `Founded with no end event (never wrong; for the owner): ${r.endEvents.filter(e => e.verdict === 'none').length} of ${r.endEvents.length}.`,
          '',
          ...r.endEvents.map(e => `- ${e.key}, run ${e.run}: ${e.verdict ?? 'no overview'}: ${cell(e.why)}`),
          '',
        ]
      : []),
    ...signalLines(r),
    ...(r.score.runs.some(s => s.mistakes.length > 0)
      ? ['### Wrong joins and foundings', '', ...r.score.runs.flatMap(s => s.mistakes.map(m => `- Run ${s.run}: ${cell(m)}`)), '']
      : []),
  ]
}
