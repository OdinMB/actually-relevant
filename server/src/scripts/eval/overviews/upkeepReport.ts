/**
 * The overview upkeep steps' report sections: the `pass-pool` step's research, the `stands` bars, the
 * `review` bars under planted errors, and the whole module's replay (`closure`, `replay`) with its
 * checkpoints, safeguards and cost. Pure.
 */
import type { OverviewStep } from '../options.js'
import { rows } from './linkReport.js'
import type { PassPoolReport } from './passPool.js'
import type { ReplayStepReport } from './replay.js'
import { cell, usd } from './reportText.js'
import type { ReviewStepReport } from './review.js'
import type { StandsStepReport } from './stands.js'

const table = ['| Measure | Bar | Mean | Verdict |', '|---|---|---|---|']

export function passPoolLines(r: PassPoolReport): string[] {
  return [
    `Production's first pass on ${r.stories} must entries of the half, in memory: ${r.withFacts} gave offerable facts, ${r.facts} facts in all. Spend ${usd(r.costUsd)}.`,
    ...r.skipped.map(s => `- Not run: ${s.storyId}: ${cell(s.reason)}`),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
  ]
}

export function standsLines(r: StandsStepReport): string[] {
  const written = r.runs.filter(x => x.outcome === 'written').length
  return [
    `${r.keys.length} developments (half ${r.half}), ${r.score.checkpoints} checkpoints, ${r.score.enough} with enough offerable facts; ${r.repeat} run${r.repeat === 1 ? '' : 's'}, ${written} stands written. Spend ${usd(r.costUsd)}.`,
    ...(r.score.note ? [`- ${cell(r.score.note)}: the gate stays closed for the stands.`] : []),
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    '',
    ...table,
    ...rows(r.score.bars),
    '',
    '### Checkpoints',
    '',
    '| Development | Day | Run | Facts offered | Outcome | Lines (unsupported) | Latest values stated | Response due / present |',
    '|---|---|---|---|---|---|---|---|',
    ...r.runs.map(
      x =>
        `| ${x.key} | ${x.day} | ${x.run} | ${x.offered}${x.enough ? '' : ' (too few)'} | ${x.outcome ?? 'not written'} | ${x.lines.length} (${x.lines.filter(l => l.supported === false).length}) | ${x.latest.filter(l => l.stated).length} of ${x.latest.length} | ${x.responseDue ? 'yes' : 'no'} / ${x.doingPresent ? 'yes' : 'no'} |`,
    ),
  ]
}

export function reviewLines(r: ReviewStepReport): string[] {
  return [
    `${r.keys.length} developments (half ${r.half}) reviewed with planted wrong joins, a flipped role and an emptied OUT list; ${r.repeat} run${r.repeat === 1 ? '' : 's'}. Spend ${usd(r.costUsd)}.`,
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    '',
    ...table,
    ...rows(r.score.bars),
    '',
    '| Run | Planted caught | Correct items demoted |',
    '|---|---|---|',
    ...r.score.runs.map(s => `| ${s.run} | ${s.caught} of ${s.planted} | ${s.demoted} of ${s.correct} |`),
  ]
}

export function replayLines(r: ReplayStepReport, steps: readonly OverviewStep[]): string[] {
  const s = r.score
  return [
    `**Replay:** ${r.stories} stories of ${r.keys.length} answer keys (half ${r.half}${r.limit !== undefined ? `; the first ${r.limit} stories only, a smoke run, not evidence` : ''}), linked and kept day by day through production's upkeep, ${r.repeat} run${r.repeat === 1 ? '' : 's'}. Spend ${usd(r.costUsd)}${s.costPerStoryUsd !== null ? `, ${usd(s.costPerStoryUsd)} a story` : ''}${s.costPerOverviewUsd !== null ? `, ${usd(s.costPerOverviewUsd)} an overview` : ''}. Checkpoints with enough evidence for the stands: ${s.evidenceShare === null ? 'n/a' : `${(s.evidenceShare * 100).toFixed(0)}%`}.`,
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
    '',
    ...table,
    ...(steps.includes('replay') ? [...rows(s.link.link), ...rows(s.link.found), ...rows(s.link.role)] : []),
    ...rows(s.closure),
    '',
    ...s.closureRuns.flatMap(c => c.premature.map(p => `- Run ${c.run}: premature: ${cell(p)}`)),
    ...(steps.includes('replay')
      ? [
          '### Checkpoints',
          '',
          '| Run | Development | At | Day | Status | Scope | Must found | Wrong members | Facts offerable | Stands (lines / doing) |',
          '|---|---|---|---|---|---|---|---|---|---|',
          ...r.runs.flatMap(run =>
            run.checkpoints.map(
              c =>
                `| ${run.run} | ${c.key} | ${c.at} | ${c.day} | ${c.overview?.status ?? 'none'}${c.overview?.frozen ? ' (frozen)' : ''} | ${c.overview?.scope ?? ''} | ${c.mustFound} of ${c.mustByThen} | ${c.wrongMembers} | ${c.offerable} | ${c.stands ? `${c.stands.sentences} / ${c.stands.doing}` : 'none'} |`,
            ),
          ),
          '',
          '### Safeguards fired (per run)',
          '',
          ...(Object.keys(s.safeguards).length === 0 ? ['None fired.'] : Object.entries(s.safeguards).map(([name, n]) => `- ${name}: ${n.toFixed(1)}`)),
        ]
      : []),
  ]
}
