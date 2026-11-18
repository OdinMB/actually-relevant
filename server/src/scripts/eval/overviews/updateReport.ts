/** The overview report's `update` section: the later pass's article step against the bars (`update.ts`, `updateScore.ts`). Pure. */
import { num, pct } from '../checks.js'
import type { CallEstimate } from './callBudget.js'
import { cell, metText, quoted, spreadText, usd } from './reportText.js'
import type { UpdateStepReport } from './update.js'
import {
  DEMOTED_BAR,
  FALSE_DEMOTION_BAR,
  FALSE_REWRITE_BAR,
  FLAGGED_BAR,
  NOTE_BAR,
  type UpdateBar,
  type UpdateBarName,
  type UpdateRunScore,
} from './updateScore.js'

const estimateText = (e: CallEstimate) => `${e.calls} calls (${e.uncached} uncached) ≈ ${usd(e.usd)}`

const BAR_TEXT: Record<UpdateBarName, { measure: string; bar: string; show: (v: number) => string }> = {
  flagged: {
    measure: 'Expected changes flagged on the right section (a turning point: some rewrite rests on it)',
    bar: `at least ${pct(FLAGGED_BAR)}`,
    show: pct,
  },
  'false-rewrites': { measure: 'Sections a strict case expects unchanged that were rewritten', bar: `at most ${pct(FALSE_REWRITE_BAR)}`, show: pct },
  identical: { measure: 'Sections no change names, byte-identical in the new version (a code assertion)', bar: '100%', show: pct },
  demoted: { measure: 'Planted contradictions whose old fact was demoted', bar: `at least ${pct(DEMOTED_BAR)}`, show: pct },
  'false-demotions': { measure: 'Cases demoting a fact they do not expect', bar: `at most ${pct(FALSE_DEMOTION_BAR)}`, show: pct },
  notes: { measure: 'Served notes the strong judge finds accurate and complete', bar: `at least ${pct(NOTE_BAR)}`, show: pct },
  unsupported: { measure: "Served notes production's checks did not pass (the fixed line aside)", bar: 'none', show: v => num(v, 1) },
  copying: { measure: "Notes' copying-flag share less the rewritten sections' share", bar: 'at most 0', show: v => `${(v * 100).toFixed(1)} points` },
}

const barRow = (b: UpdateBar) => {
  const t = BAR_TEXT[b.name]
  return `| ${t.measure} | ${t.bar} | ${b.value === null ? 'n/a' : t.show(b.value)} | ${spreadText(b.spread)} | ${metText(b.met)} |`
}

const share = (c: { hit: number; of: number; share: number | null }) => `${c.hit} / ${c.of} (${pct(c.share)})`

const runRow = (s: UpdateRunScore) =>
  `| ${s.run} | ${s.cases} | ${s.outcomes.updated} / ${s.outcomes.unchanged} / ${s.outcomes.update_failed} / ${s.outcomes.budget + s.outcomes.technical} | ${share(s.flagged)} | ${share(s.falseRewrites)} | ${share(s.identical)} | ${share(s.demoted)} | ${share(s.falseDemotions)} | ${share(s.notes)}; ${s.notes.fallback} fixed lines | ${share(s.copying.notes)} vs ${share(s.copying.paragraphs)} |`

export function updateLines(r: UpdateStepReport): string[] {
  const judge = r.judge
  const l = r.score.listed
  const cases = Object.entries(r.cases)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
  return [
    `**Cases:** ${cases}, from ${r.stories} researched stories of ${r.keys} answer keys (half ${r.half}${r.limit !== undefined ? `, the first ${r.limit} stories: a smoke run, not evidence` : ''}), each run ${r.repeat} time${r.repeat === 1 ? '' : 's'} through production's later-pass article step (\`updateArticle\`) with the eval's cached calls. Each story's version is the one the legacy import makes; the facts it cites count as supported.`,
    ...(r.unplaced > 0 ? [`- ${r.unplaced} changed figure values have a quote no section holds: left out of the expectations.`] : []),
    ...(r.deskUsd !== null ? [`- Dry run: desk estimate up to ${usd(r.deskUsd)} (each case's reserve and the note judge).`] : []),
    ...r.left.map(x => `- Left out: ${x.what}: ${cell(x.reason)}`),
    ...r.skipped.map(s => `- Not run: ${s.storyId}: ${s.reason}`),
    '',
    ...(judge?.stopped
      ? [`**The strong judge did not run:** ${cell(judge.stopped)} (${estimateText(judge.estimate)}). The notes bar has no verdicts.`, '']
      : judge
        ? [`**Strong judge on the notes:** ${estimateText(judge.estimate)}.`, '']
        : []),
    'Means over the runs. A case the budget or a failed call stopped is counted, not measured.',
    '',
    '| Measure | Bar | Mean | Across runs | Verdict |',
    '|---|---|---|---|---|',
    ...r.score.bars.map(barRow),
    '',
    '### Per run',
    '',
    '| Run | Cases | Updated / unchanged / failed / stopped | Flagged | False rewrites | Identical | Demoted | False demotions | Notes good | Copying: notes vs sections |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...r.score.runs.map(runRow),
    '',
    '### For a read',
    '',
    ...(l.missed.length > 0 ? ['**Expected changes not flagged:**', '', ...l.missed.map(m => `- ${m.id} (run ${m.run}): ${m.what}: ${cell(m.why)}`), ''] : []),
    ...(l.falseRewrites.length > 0
      ? ['**False rewrites:**', '', ...l.falseRewrites.map(f => `- ${f.id} (run ${f.run}): ${f.label}: ${quoted(f.reason)}`), '']
      : []),
    ...(l.falseDemotions.length > 0
      ? ['**False demotions:**', '', ...l.falseDemotions.map(f => `- ${f.id} (run ${f.run}): ${f.ref}: ${quoted(f.reason)}`), '']
      : []),
    ...(l.notes.length > 0 ? ['**Notes judged short:**', '', ...l.notes.map(n => `- ${n.id} (run ${n.run}): ${quoted(n.note)}: ${cell(n.problem)}`), ''] : []),
  ]
}
