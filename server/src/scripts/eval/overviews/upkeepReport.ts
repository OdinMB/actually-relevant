/**
 * The overview upkeep steps' report sections: the `pass-pool` step's research, the `stands` bars, the
 * `review` bars under planted errors, the `recenter` bars on planted and real cases, and the whole
 * module's replay (`replay`): what it replayed (the background's stories beside the half's), its linking
 * bars, runs, wrong joins and foundings by name, checkpoints with their wrong members by name, missed
 * must entries and charters (the linking report's own sections, `linkReport.ts`), safeguards,
 * re-centers (a background overview's marked unscored) and cost. Pure.
 */
import type { Role } from '../../../services/overviewTypes.js'
import { charterLines, missedLines, mistakeLines, perRunLines, rows, storiesReplayed } from './linkReport.js'
import { MEMBERS_PER_CHECKPOINT, type PassPoolReport } from './passPool.js'
import type { RecenterStepReport } from './recenter.js'
import type { ReplayStepReport } from './replay.js'
import type { CheckpointState } from './replayScore.js'
import { cell, usd } from './reportText.js'
import type { ReviewStepReport } from './review.js'
import type { StandsStepReport } from './stands.js'

const table = ['| Measure | Bar | Mean | Verdict |', '|---|---|---|---|']

export function passPoolLines(r: PassPoolReport): string[] {
  const ran = r.stories - r.skipped.length
  return [
    `Production's first pass, in memory, on ${r.stories} of the half's ${r.mustEntries} must entries (the newest ${MEMBERS_PER_CHECKPOINT} at each stands checkpoint): ${r.withFacts} gave offerable facts, ${r.facts} facts in all. Spend this run ${usd(r.costUsd)}${ran > 0 ? `, ${usd(r.costUsd / ran)} a story (a story the cache answered costs nothing)` : ''}.`,
    ...r.skipped.map(s => `- Not run: ${s.storyId}: ${cell(s.reason)}`),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
  ]
}

/** What the owner reads where a stands bar is not met or is left to them: each latest value not stated and each line the judge found unsupported. */
function standsMisses(r: StandsStepReport): string[] {
  const at = (x: StandsStepReport['runs'][number]) => `${x.key} ${x.day} run ${x.run}`
  const misses = r.runs
    .filter(x => x.enough)
    .flatMap(x => [
      ...x.latest.filter(l => !l.stated).map(l => `- ${at(x)}: ${l.figure} ${l.value} not stated`),
      ...x.lines.filter(l => l.supported === false).map(l => `- ${at(x)}: unsupported: ${cell(l.text)}`),
    ])
  return misses.length === 0 ? [] : ['', '### Latest values not stated, lines judged unsupported', '', ...misses]
}

/** The lines the write gave and a check dropped, each with the check and its reason, then the lines kept: what the stands lost and why, for a read. */
function standsDrops(r: StandsStepReport): string[] {
  const at = (x: StandsStepReport['runs'][number]) => `${x.key} ${x.day} run ${x.run}`
  const drops = r.runs.flatMap(x =>
    (x.dropped ?? []).map(d => `- ${at(x)}: ${d.label} (${d.cause}${d.problem ? `: ${cell(d.problem)}` : ''}): ${cell(d.text)}`),
  )
  const kept = r.runs.flatMap(x => x.lines.map(l => `- ${at(x)}: ${l.part}: ${cell(l.text)}`))
  return [
    ...(drops.length > 0 ? ['', '### Lines written and dropped by a check', '', ...drops] : []),
    ...(kept.length > 0 ? ['', '### Lines kept', '', ...kept] : []),
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
    ...standsMisses(r),
    ...standsDrops(r),
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
    '| Run | Planted caught | Correct items taken out | Correct items relabeled |',
    '|---|---|---|---|',
    ...r.score.runs.map(s => `| ${s.run} | ${s.caught} of ${s.planted} | ${s.removed} of ${s.correct} | ${s.relabeled} of ${s.correct} |`),
    ...(r.score.demotions.length > 0
      ? [
          '',
          `**Correct items changed:** ${r.score.demotions.filter(d => d.how === 'removed').length} taken out, ${r.score.demotions.filter(d => d.how === 'relabeled').length} relabeled.`,
          '',
          ...r.score.demotions.map(d =>
            d.how === 'removed'
              ? `- ${d.key} run ${d.run}: ${slugOf(d.entryId)}: taken out: ${cell(d.reason ?? '')}`
              : `- ${d.key} run ${d.run}: ${slugOf(d.entryId)}: relabeled, the key says ${roleText(d.keyRole)}, the review ${roleText(d.to)}`,
          ),
        ]
      : []),
    ...(r.score.misses.length > 0
      ? [
          '',
          '**Planted errors left standing:**',
          '',
          ...r.score.misses.map(m => `- ${m.key} run ${m.run}: ${m.what}${m.entryId ? `: ${slugOf(m.entryId)}` : ''}`),
        ]
      : []),
  ]
}

/** An eval entry id (`key:<slug>`, `planted:<slug>`) as its story's slug. */
const slugOf = (entryId: string): string => entryId.replace(/^(key|planted):/, '')

const roleText = (r: Role | undefined): string => (!r ? 'none' : r.role === 'turning_point' ? `turning point (${r.roleKind ?? 'no kind'})` : 'routine')

export function recenterLines(r: RecenterStepReport): string[] {
  const s = r.score
  const held = Object.entries(s.heldBy).map(([by, n]) => `${by} ${n}`)
  return [
    `${r.planned.length} cases of ${r.keys.length} answer keys (half ${r.half}${r.limit !== undefined ? `; the first ${r.limit} cases only, a smoke run, not evidence` : ''}): production's automated re-center (the draft, its blind check, the code rules) asked directly, bypassing the signal (each offered story carries one signal quote). Planted narrowed charters and reviewed centers expect a re-center; the anchor breach, the neighbor a wider charter would absorb and the end-checkpoint negatives expect none. ${s.positives} expected re-centers answered, ${s.negatives} others, ${s.failed} attempts a call gave nothing for. Spend ${usd(r.costUsd)}.`,
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    ...r.notRun.map(x => `- Not run: ${x.what}: ${cell(x.reason)}`),
    '',
    ...table,
    ...rows(s.bars),
    '',
    `End events of the expected re-centers: ${s.endEvents.right} right, ${s.endEvents.wrong} wrong, ${s.endEvents.none} naming none (counted, never wrong), ${s.endEvents.unjudged} unjudged. Where none was expected, what held: ${held.join(', ') || 'no such attempt answered'}.`,
    '',
    '### Attempts',
    '',
    '| Case | Day | Run | Outcome | Refused by | Title | END_EVENT | Joined | Near misses joined | Detached | End event judged |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...r.runs.map(
      x =>
        `| ${x.case} | ${x.day} | ${x.run} | ${x.outcome} | ${x.refusals.join(', ')} | ${cell(x.title ?? '')} | ${cell(x.endEvent ?? 'none')} | ${x.joined.length} | ${x.nearMissesJoined.join(', ')} | ${x.detached.length} | ${x.endEventVerdict ?? ''}${x.why ? `: ${cell(x.why)}` : ''} |`,
    ),
  ]
}

export function replayLines(r: ReplayStepReport): string[] {
  const s = r.score
  const costs = [
    ...(s.costPerStoryUsd !== null ? [`${usd(s.costPerStoryUsd)} a story`] : []),
    ...(s.costPerOverviewUsd !== null ? [`${usd(s.costPerOverviewUsd)} an overview`] : []),
  ]
  return [
    `**Replay:** ${storiesReplayed(r)}, linked and kept day by day through production's upkeep, ${r.repeat} run${r.repeat === 1 ? '' : 's'}. Spend ${usd(r.costUsd)}${costs.length > 0 ? `, ${costs.join(', ')} (over every story and overview replayed, the background's too)` : ''}. Checkpoints with enough evidence for the stands: ${s.evidenceShare === null ? 'n/a' : `${(s.evidenceShare * 100).toFixed(0)}%`}.`,
    ...(r.background.stories > 0
      ? [
          "- The background developments get overviews, reviews and stands as any other, and no bar scores them: a background story counts only as a wrong join in a judged development's overview, a founding only with a judged story in its pair.",
        ]
      : []),
    ...(r.stopped ? [`- Stopped: ${cell(r.stopped)}`] : []),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
    '',
    ...table,
    ...rows(s.link.link),
    ...rows(s.link.found),
    ...rows(s.link.role),
    '',
    ...perRunLines(s.link),
    ...mistakeLines(s.link.runs),
    ...checkpointLines(r),
    ...missedLines(r),
    ...charterLines(r),
    '### Safeguards fired (per run)',
    '',
    "Counted over every overview, the background developments' too.",
    '',
    ...(Object.keys(s.safeguards).length === 0 ? ['None fired.'] : Object.entries(s.safeguards).map(([name, n]) => `- ${name}: ${n.toFixed(1)}`)),
    '',
    ...replayRecenterLines(r),
  ]
}

/** A checkpoint's status, and whose overview it is when it stands for another development than the checkpoint's own. */
function checkpointStatus(c: CheckpointState): string {
  if (!c.overview) return 'none'
  const { development } = c.overview
  const whose = development === c.key ? '' : ` (${development === null ? 'an overview of no development' : `${development}'s overview`})`
  return `${c.overview.status}${c.overview.frozen ? ' (frozen)' : ''}${whose}`
}

/** Each development's checkpoints, then the wrong members of each by name. */
function checkpointLines(r: ReplayStepReport): string[] {
  const wrong = r.runs.flatMap(run =>
    run.checkpoints
      .filter(c => c.wrongMembers.length > 0)
      .map(c => `- Run ${run.run}, ${c.key} at ${c.at} (${c.day}), "${cell(c.overview?.title ?? '')}": ${c.wrongMembers.map(cell).join('; ')}`),
  )
  return [
    '### Checkpoints',
    '',
    '| Run | Development | At | Day | Status | Scope | Must found | Wrong members | Facts offerable | Stands (lines / doing) |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...r.runs.flatMap(run =>
      run.checkpoints.map(
        c =>
          `| ${run.run} | ${c.key} | ${c.at} | ${c.day} | ${checkpointStatus(c)} | ${c.overview?.scope ?? ''} | ${c.mustFound} of ${c.mustByThen} | ${c.wrongMembers.length} | ${c.offerable} | ${c.stands ? `${c.stands.sentences} / ${c.stands.doing}` : 'none'} |`,
      ),
    ),
    '',
    ...(wrong.length > 0 ? ["The wrong members of each development's overview at its checkpoints, as the joins bar reads them:", '', ...wrong, ''] : []),
  ]
}

/** The replay's automated re-centers: the bars, then for the owner the counts, each re-center's day against its center's from, and each one. */
function replayRecenterLines(r: ReplayStepReport): string[] {
  const s = r.score.recentering
  const perRun = (v: number | null) => (v === null ? 'n/a' : v.toFixed(1))
  const unscored = (development: string | null) => development !== null && !r.keys.includes(development)
  const each = r.runs.flatMap(run => run.recenters.map(x => ({ run: run.run, ...x })))
  return [
    '### Automated re-centers',
    '',
    ...table,
    ...rows(s.bars),
    '',
    `Applied per run: ${perRun(s.applied)} scored (of the half's developments' overviews, or of one standing for none), and ${perRun(s.unscored)} of background developments' overviews, unscored: no bar counts them. The most on one overview in a run, of every overview: ${s.mostPerOverview} (the limit is 2). Splits (an overview founded by two center entries of one key; for the owner, never a right founding): ${perRun(s.splits)} per run. Attempts by what fired them, and refusals by rule, are among the safeguards above.`,
    ...s.timing.map(t => `- Run ${t.run}: ${t.key} re-centered on ${t.day}, its center from ${t.from}`),
    ...each.map(
      x =>
        `- Run ${x.run}, ${x.day}: ${cell(x.title)} (${x.development ?? 'no development'}), ${x.joined.length} joined${x.nearMissesJoined.length > 0 ? `, near misses ${x.nearMissesJoined.join(', ')}` : ''}${unscored(x.development) ? ', unscored' : ''}`,
    ),
  ]
}
