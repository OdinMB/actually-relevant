/**
 * The overview linking steps' report sections (`link.ts`): what was replayed, then the bars of each
 * step that ran (`link`, `found`, `role`) and the runs' details, and the diagnostics
 * (`linkDiagnostics.ts`): the missed must entries with why, the role disagreements, the founded
 * charters. Pure.
 */
import type { OverviewStep } from '../options.js'
import { cell, usd } from './reportText.js'
import type { LinkStepReport } from './link.js'
import { MISS_CAUSES, missesByDevelopment } from './linkDiagnostics.js'
import type { Bar } from './linkScore.js'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const value = (b: Bar) => (b.value === null ? 'n/a' : b.direction === 'atMost' && !b.share ? b.value.toFixed(2) : pct(b.value))
const target = (b: Bar) =>
  b.direction === 'atLeast' ? `at least ${Math.round(b.target * 100)}%` : `at most ${b.share ? `${Math.round(b.target * 100)}%` : b.target}`
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

/** Every must entry not found in its development's overview, by development and cause, then one line each. */
function missedLines(r: LinkStepReport): string[] {
  if (r.diagnostics.every(d => d.missed.length === 0)) return []
  const table = missesByDevelopment(r.diagnostics)
  const causes = MISS_CAUSES.filter(c => table.some(t => t.causes.has(c)))
  return [
    '### Missed must entries (diagnostics; no bar)',
    '',
    `Summed over the ${r.diagnostics.length} run${r.diagnostics.length === 1 ? '' : 's'}. **no candidate**: the story was shown nothing and no call was made; **not offered**: its development's overview or a partner of its development was not among the candidates shown; **refused by code**: the model said yes and the quote checks refused it (the rule is given); **founding blocked**: a partner of its development passed, but the model's yes to another development's overview, refused by code, kept the story from founding; **founding not agreed**: a founding with a partner of its development was drafted and refused or not agreed by the check; **model no / unsure**: the model's answer for its development's candidates (confidence, and scope when not inside; the link answer gives no reason). "Before … was founded" marks a story linked before its development had an overview.`,
    '',
    `| Development | ${causes.join(' | ')} | All |`,
    `|---|${causes.map(() => '---|').join('')}---|`,
    ...table.map(t => `| ${t.key} | ${causes.map(c => t.causes.get(c) ?? 0).join(' | ')} | ${t.total} |`),
    '',
    ...r.diagnostics.flatMap(d => d.missed.map(m => `- Run ${d.run}, ${m.slug} (${m.key}, ${m.date}): **${m.cause}**: ${cell(m.detail)}`)),
    '',
  ]
}

/** Found must entries whose role disagrees with the key's, per run. */
function roleLines(r: LinkStepReport): string[] {
  if (r.diagnostics.length === 0) return []
  return [
    '### Role disagreements (diagnostics; no bar)',
    '',
    '"Key accepts either": judged entries the key marks `eitherRole`, where careful editors could call the story either; they count as agreeing whatever role was given, so the agreeing share holds them.',
    '',
    '| Run | Judged | Agreeing | Key accepts either | Key turning point, given routine | Key routine, given turning point |',
    '|---|---|---|---|---|---|',
    ...r.diagnostics.map(d => {
      const under = d.roleMisses.filter(m => m.expected === 'turning_point').length
      return `| ${d.run} | ${d.rolesJudged} | ${d.rolesJudged - d.roleMisses.length} | ${d.rolesEither} | ${under} | ${d.roleMisses.length - under} |`
    }),
    '',
    ...r.diagnostics.flatMap(d =>
      d.roleMisses.map(
        m => `- Run ${d.run}, ${m.slug} (${m.key}): key ${m.expected}, given ${m.given.role}${m.given.roleKind ? ` (${m.given.roleKind})` : ''}`,
      ),
    ),
    '',
  ]
}

/** When each development's first overview was founded, per run, and the joins whose quotes passed only by the near match. */
function foundingDateLines(r: LinkStepReport): string[] {
  if (r.diagnostics.every(d => d.firstFoundings.length === 0 && d.nearMatches.length === 0)) return []
  return [
    '### First founding of each development (diagnostics; no bar)',
    '',
    "The day each development's first overview was founded in each run, to read against its key's first two occurrences (`occurrences`): stories before it could join nothing.",
    '',
    ...r.diagnostics.map(d => `- Run ${d.run}: ${d.firstFoundings.map(f => `${f.key} ${f.foundedOn}`).join(', ') || 'none'}`),
    '',
    ...(r.diagnostics.some(d => d.nearMatches.length > 0)
      ? [
          'Joins whose cause or place quote passed only by the near match (small misspellings in long words), with the joins bar verdict:',
          '',
          ...r.diagnostics.flatMap(d => d.nearMatches.map(n => `- Run ${d.run}, ${n.slug} into "${cell(n.overview)}": ${n.verdict ?? 'not scored'}`)),
          '',
        ]
      : []),
  ]
}

/** Every founded overview's charter, per run. */
function charterLines(r: LinkStepReport): string[] {
  if (r.diagnostics.every(d => d.charters.length === 0)) return []
  return [
    '### Founded charters (diagnostics; no bar)',
    '',
    ...r.diagnostics.flatMap(d =>
      d.charters.flatMap(c => [
        `- Run ${d.run}: **${cell(c.title)}**, standing for ${c.development ?? 'no development'}; founded ${c.foundedOn} from ${c.foundedFrom.map(f => `${f.slug} (${f.as})`).join(' and ')}; members as the joins bar reads them: ${c.members.right} right, ${c.members.wrong} wrong, ${c.members.ignored} optional (ignored), ${c.members.unscored} not scored`,
        `  - IN: ${cell(c.charter.in)}`,
        `  - OUT: ${c.charter.out.length === 0 ? 'none' : c.charter.out.map(cell).join(' · ')}`,
        `  - END_EVENT: ${c.charter.endEvent === null ? 'none (closes by fading)' : cell(c.charter.endEvent)}`,
      ]),
    ),
    '',
  ]
}

/** What was replayed: the half's stories and, in a judged run, the background stories beside them (`backgroundOf`). */
function replayed(r: LinkStepReport): string {
  const half = `${r.keys.length} answer keys (half ${r.half}: ${r.keys.join(', ') || 'none'}${r.limit !== undefined ? `; the first ${r.limit} stories only, a smoke run, not evidence` : ''})`
  if (r.background.stories === 0) return `${r.stories} stories (entries and near misses) of ${half}`
  return `${r.stories} stories: ${r.stories - r.background.stories} (entries and near misses) of ${half}, and ${r.background.stories} background stories of ${r.background.keys.join(', ')}, unscored unless they join a judged development's overview`
}

/** The duplicate groups merged into their keeps before the replay (ADR-0076): each keep, its drops with what the keys made of them, and why. */
function mergedLines(r: LinkStepReport): string[] {
  if (r.merged.length === 0) return []
  return [
    '### Duplicates merged before the replay',
    '',
    "Two reports of one event or study reach the replay as one story, its keep, as production's duplicate detection would have had them (`duplicates.json`). Where a key held a drop but not its keep, the keep took the drop's place with its label.",
    '',
    ...r.merged.map(g => `- **${g.keep}** (${g.confidence}): ${g.drops.map(d => `${d.slug} (${d.as.join('; ')})`).join(', ')}. ${cell(g.why)}`),
    '',
  ]
}

const mergedCount = (r: LinkStepReport) => r.merged.reduce((n, g) => n + g.drops.length, 0)

/** A rescore's line: the saved replay it scored, and whether today's keys replay the stories it replayed. */
function rescoredLine(r: LinkStepReport): string[] {
  if (!r.rescored) return []
  const { file, savedAt, added, removed } = r.rescored
  const scored = `- Rescored: ${file}, saved ${savedAt}, scored again under today's keys and scorer with no model call; the end-event judge answered from the cache only.`
  if (added.length === 0 && removed.length === 0) return [scored]
  return [
    `${scored} Against keys that replay another set of stories: not evidence for the gate. ${added.length} the keys name since the run (left out, below), ${removed.length} the run replayed that they no longer name${removed.length > 0 ? ` (${removed.join(', ')})` : ''}, scored as they fell.`,
  ]
}

export function linkLines(r: LinkStepReport, steps: readonly OverviewStep[]): string[] {
  const shown = (step: OverviewStep) => steps.includes(step)
  return [
    `**Replay:** ${replayed(r)}, ${r.repeat} run${r.repeat === 1 ? '' : 's'} through production's linking against the in-memory sandbox, oldest first${mergedCount(r) > 0 ? `, after ${mergedCount(r)} duplicate stor${mergedCount(r) === 1 ? 'y was' : 'ies were'} merged into ${r.merged.length === 1 ? 'its keep' : 'their keeps'} (below)` : ''}. The replay's calls as made (cached ones at what they cost then) and the end-event judge's: ${usd(r.costUsd)}${r.perStoryUsd !== null ? `, ${usd(r.perStoryUsd)} a story` : ''}.`,
    ...rescoredLine(r),
    ...(r.unanswered > 0
      ? [
          `- Calls not made: ${r.unanswered} (past the budget, or not in the cache with --cache-only); a story whose call got no answer is linked as failed, so this run is not the one cached.`,
        ]
      : []),
    ...(r.errored > 0
      ? [
          `- Calls that failed: ${r.errored} (an API error after the client's retries, a rate limit among them); a story whose call failed is linked as failed. If they persist, run again at a lower --concurrency.`,
        ]
      : []),
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
    '| Run | Joins right / wrong | Must entries found | Overviews founded (with a judged story) | Of those, not one development / repeat (wrong share) | Roles agreeing (of them, the key accepting either) |',
    '|---|---|---|---|---|---|',
    ...r.score.runs.map(
      s =>
        `| ${s.run} | ${s.right} / ${s.wrong} | ${s.found} of ${s.must} | ${s.foundings} (${s.judgedFoundings}) | ${s.wrongFoundings} / ${s.repeatFoundings} (${s.judgedFoundings === 0 ? 'n/a' : pct(s.foundingsWrong / s.judgedFoundings)}) | ${s.rolesAgreeing} of ${s.rolesJudged} (${s.rolesEither}) |`,
    ),
    '',
    'A repeat founds a development that already has an open overview in the run (joining that one was the right move); a founding both not of one development and a repeat counts once in the share.',
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
    ...mergedLines(r),
    ...(r.score.runs.some(s => s.mistakes.length > 0)
      ? ['### Wrong joins and foundings', '', ...r.score.runs.flatMap(s => s.mistakes.map(m => `- Run ${s.run}: ${cell(m)}`)), '']
      : []),
    ...(r.score.runs.some(s => s.backgroundRepeats.length > 0)
      ? [
          '### Background repeat foundings (unscored; diagnostics)',
          '',
          'Foundings of two background stories whose development already had an open overview in the run: no bar counts them.',
          '',
          ...r.score.runs.flatMap(s => s.backgroundRepeats.map(m => `- Run ${s.run}: ${cell(m)}`)),
          '',
        ]
      : []),
    ...(shown('link') ? missedLines(r) : []),
    ...(shown('role') ? roleLines(r) : []),
    ...(shown('found') || shown('link') ? foundingDateLines(r) : []),
    ...(shown('found') || shown('link') ? charterLines(r) : []),
  ]
}
