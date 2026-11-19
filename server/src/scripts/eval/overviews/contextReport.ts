/**
 * The overview report's story-context sections (plan `.plans/2026-11-16_story-context.md`, "Eval gate
 * before switching on"): the gap keys against the database (`gap-keys`), the drafted keys
 * (`gap-draft`), and production's pipeline replayed on the keys' stories against the bars, with the
 * runs, the items for a read and the replay's hindsight (`context`). Pure.
 */
import { num, pct } from '../checks.js'
import type { Spread } from '../repeats.js'
import type { ContextStepReport } from './context.js'
import { MAX_FIELD_FACTS } from './contextJudge.js'
import {
  COST_BAR_USD,
  FIELDS_BAR,
  LABELED_FIELDS,
  NEEDS_BAR,
  PLACEMENT_BAR,
  RESPONSE_BAR,
  WASTED_SEARCH_BAR,
  type Bar,
  type BarName,
  type FieldScore,
  type ResultDates,
  type RunScore,
} from './contextScore.js'
import { GAP_SAMPLE_SIZE, GAP_WINDOW_MONTHS, type GapDraftReport } from './gapDraft.js'
import type { GapKeyResult } from './gapKeyCheck.js'
import { cell, estimateText, metText, quoted, usd } from './reportText.js'

const tally = (values: string[]) => {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// ---------------------------------------------------------------------------
// Gap keys
// ---------------------------------------------------------------------------

export function gapKeyLines(keys: GapKeyResult[]): string[] {
  if (keys.length === 0) return ['No gap keys committed yet (`server/src/scripts/eval/overviews/gapKeys/`): draft them with `--steps gap-draft`.']
  const summaries = keys.flatMap(k => (k.summary ? [k.summary] : []))
  const half = (h: string) => summaries.filter(s => s.half === h).length
  const response = tally(summaries.map(s => s.response))
  const row = (k: GapKeyResult) => {
    const s = k.summary
    if (!s) return `| ${k.file} | (does not parse) | | | | ${k.errors.length} |`
    return `| ${cell(s.title)} | ${k.file} | ${s.half} | ${s.needs} (${s.must} must, ${s.openMust} not in the story) | ${s.response} | ${k.errors.length} |`
  }
  const withErrors = keys.filter(k => k.errors.length > 0)
  return [
    `${keys.length} gap keys: ${half('tune')} in the tune half, ${half('judge')} in the judge half (fixed by the slug's sha256; prompts are tuned on tune only, the gate is read on judge). Response needs: ${response.map(([kind, n]) => `${kind} ${n}`).join(', ') || 'none'}. An error is a mistake in the key, to fix there.`,
    '',
    '| Story | File | Half | Needs | Response | Errors |',
    '|---|---|---|---|---|---|',
    ...keys.map(row),
    ...(withErrors.length > 0 ? ['', '### Gap key errors', '', ...withErrors.flatMap(k => [`**${k.file}**`, '', ...k.errors.map(e => `- ${e}`), ''])] : []),
  ]
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function gapDraftLines(r: GapDraftReport): string[] {
  const drafts = new Map(r.drafts.map(d => [d.slug, d]))
  const noInput = new Set(r.noInput)
  const status = (slug: string) => {
    const d = drafts.get(slug)
    if (d) return d.key ? 'written' : `none (${d.outcome})`
    return noInput.has(slug) ? 'no input' : 'not drafted'
  }
  const withErrors = r.drafts.filter(d => d.key && d.errors.length > 0).length
  return [
    `**Sample:** ${r.sample.length} of ${GAP_SAMPLE_SIZE} stories from ${r.candidates} candidates: published in the ${GAP_WINDOW_MONTHS} months to the newest published story (${r.anchor ?? 'none'}), each with a completed research run whose sources hold facts, none named by a development key; spread over top-level issue × figure-heavy or figure-light. Sampled ${r.createdAt}; \`--refresh-fixtures\` samples again.`,
    ...r.shortfalls.map(s => `- Shortfall: ${s}`),
    '',
    `Strata: ${tally(r.sample.map(s => s.stratum))
      .map(([s, n]) => `${s} ${n}`)
      .join(', ')}.`,
    '',
    r.stopped
      ? `**Drafts:** none; the calls did not run: ${cell(r.stopped)} (${estimateText(r.estimate)}).`
      : `**Drafts:** ${r.drafts.filter(d => d.key).length} written to \`gap-drafts/\` in this folder, ${withErrors} of them with format errors to fix; ${r.drafts.filter(d => !d.key).length} calls gave no draft (${estimateText(r.estimate)}).`,
    ...(r.noInput.length > 0 ? [`No input (production's loader found no published story with a research run's facts): ${r.noInput.join(', ')}.`] : []),
    '',
    '| Story | Stratum | Draft | Format errors |',
    '|---|---|---|---|',
    ...r.sample.map(s => `| ${s.slug} | ${s.stratum} | ${status(s.slug)} | ${cell(drafts.get(s.slug)?.errors.join('; ') ?? '')} |`),
    '',
    'Each draft is checked against its story before it is committed to `gapKeys/`: generic needs cut, each `accepts` made concrete enough to judge, `must` against `nice` confirmed, `inStory` set where the story already states the need. Then `--steps gap-keys` checks the committed keys against the database.',
  ]
}

// ---------------------------------------------------------------------------
// Story context against the bars
// ---------------------------------------------------------------------------

const BAR_TEXT: Record<BarName, { measure: string; bar: string; show: (v: number) => string }> = {
  needs: { measure: "Must needs the story doesn't state, met by the kept cards", bar: `at least ${pct(NEEDS_BAR)}`, show: pct },
  wasted: { measure: 'Wasted searches per story, the response searches apart', bar: `at most ${WASTED_SEARCH_BAR}`, show: v => num(v) },
  response: { measure: "A response card, where the key's response need is findable", bar: `at least ${pct(RESPONSE_BAR)}`, show: pct },
  boxes: { measure: 'Box items the strong judge finds their cited facts do not support', bar: 'none', show: v => num(v, 1) },
  placement: { measure: 'Notes `model` places beside a paragraph or point that add to it', bar: `at least ${pct(PLACEMENT_BAR)}`, show: pct },
  cost: {
    measure: 'Cost per story, the whole first pass (model calls at the flex price, plus search credits)',
    bar: `at most ${usd(COST_BAR_USD)}`,
    show: v => usd(v),
  },
}

const range = (s: Spread | null, show: (v: number) => string) =>
  !s ? 'n/a' : s.n === 1 ? 'one run' : `${show(s.min)} to ${show(s.max)}, SD ${s.sd === null ? 'n/a' : show(s.sd)}`

const barRow = (b: Bar) => {
  const t = BAR_TEXT[b.name]
  return `| ${t.measure} | ${t.bar} | ${b.value === null ? 'n/a' : t.show(b.value)} | ${range(b.spread, t.show)} | ${metText(b.met)} |`
}

const fieldsRow = (f: FieldScore) =>
  `| Figure facts whose structured fields are all right; invented numbers the fact check passed | at least ${pct(FIELDS_BAR)}; none | ${pct(f.share)}; ${f.inventedPassed} | ${range(f.spread, pct)} | ${metText(f.met)} |`

const runRow = (r: RunScore) =>
  `| ${r.run} | ${r.stories} | ${r.failed} | ${r.needs.met} of ${r.needs.must} | ${r.searches.total} (${r.searches.wasted}; ${r.searches.notNeeded}) | ${r.searches.response.hit} of ${r.searches.response.total} (${pct(r.searches.response.share)}) | ${r.response.withCard} of ${r.response.findable} | ${r.boxes.judged} (${r.boxes.unsupported ?? 'n/a'}; ${r.boxes.unjudged}) | ${pct(r.placement.model.share)} of ${r.placement.model.notes} / ${pct(r.placement.random.share)} of ${r.placement.random.notes} | ${usd(r.costUsd)} |`

function hindsightLines(d: ResultDates): string[] {
  const share = (n: number) => pct(d.results === 0 ? null : n / d.results)
  return [
    `**Replay hindsight:** ${d.searches} searches gave ${d.results} results, ${d.undated} of them undated (${share(d.undated)}) and ${d.afterStory} dated after the story's day (${share(d.afterStory)}). Each search ends on the story's publication day, but that filters only dated results, and a page updated later can keep its first date: the replay may see some of what came after the story, so its scores can flatter production by up to that share of results.`,
  ]
}

function fieldLines(f: FieldScore): string[] {
  const wrong = LABELED_FIELDS.map(k => `${k} ${f.wrong[k]}`).join(', ')
  return [
    `**Structured fields:** the strong judge labeled ${f.labeled} figure facts (at most ${MAX_FIELD_FACTS}, from every run) against their evidence: ${f.fullyRight} fully right (${pct(f.share)}). Wrong by field: ${wrong}. Invented numbers production's fact check passed: ${f.inventedPassed}.`,
  ]
}

function listedLines(r: ContextStepReport): string[] {
  const { unsupported, unmet, wasted } = r.score.listed
  const section = (title: string, lines: string[]) => [`#### ${title} (${lines.length})`, '', ...(lines.length > 0 ? lines : ['None.']), '']
  return [
    ...section(
      'Box items found unsupported',
      unsupported.map(u => `- ${u.slug}#${u.run}, ${cell(u.label)}: ${quoted(u.text)}: ${cell(u.problem) || 'no reason given'}`),
    ),
    ...section(
      "Must needs the story doesn't state, not met",
      unmet.map(u => `- ${u.slug}#${u.run}: ${u.need}`),
    ),
    ...section(
      'Wasted searches',
      wasted.map(w => `- ${w.slug}#${w.run}, ${w.slot}: ${quoted(w.query)}`),
    ),
    ...section(
      'Figure facts with a wrong field or an invented number',
      r.fields.listed.map(
        l =>
          `- ${l.key} (${l.verdict}): ${
            LABELED_FIELDS.filter(k => !l.right[k]).join(', ') || 'fields right'
          }${l.invented ? '; invented number' : ''}${l.problem ? `: ${cell(l.problem)}` : ''}`,
      ),
    ),
  ]
}

export function contextLines(r: ContextStepReport): string[] {
  const judge = r.judge
  return [
    `**Stories:** ${r.stories} of ${r.keys} gap keys chosen (half ${r.half}${r.limit !== undefined ? `, the first ${r.limit}: a smoke run, not evidence` : ''}), each run ${r.repeat} time${r.repeat === 1 ? '' : 's'} through production's pipeline (\`buildStoryContext\`) with the eval's cached calls and searches, no opt-out policy.`,
    ...r.left.map(l => `- Left out: ${l.file}: ${l.reason}`),
    ...r.skipped.map(s => `- Not run: ${s.storyId}: ${s.reason}`),
    '',
    ...(judge?.stopped
      ? [
          `**The strong judge did not run:** ${cell(judge.stopped)} (${estimateText(judge.estimate)}). The needs, boxes, placement and fields bars have no verdicts.`,
          '',
        ]
      : judge
        ? [`**Strong judge:** ${estimateText(judge.estimate)}.`, '']
        : []),
    'Means over the runs (the design\'s first bars; the first run measures baseline and noise). The planted-error bar on module-1 facts is read in "Fact check under planted errors" when the run takes `--facts context`.',
    '',
    '| Measure | Bar | Mean | Across runs | Verdict |',
    '|---|---|---|---|---|',
    ...r.score.bars.map(barRow),
    fieldsRow(r.fields),
    '',
    '### Per run',
    '',
    'Searches show the wasted ones and those for a slot the key marks not needed. The `response` searches are never wasted, since the step always makes them; their own column counts those that found a fact a kept box cites. Box items show the unsupported and those without a verdict. Placement is `model` against `random` on the same stories.',
    '',
    '| Run | Stories | Failed | Must needs met | Searches (wasted; not needed) | Response searches that found a cited fact | Response cards where findable | Box items (unsupported; unjudged) | Placement model / random | Cost per story |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...r.score.runs.map(runRow),
    '',
    ...fieldLines(r.fields),
    '',
    ...hindsightLines(r.dates),
    '',
    '### For a read',
    '',
    ...listedLines(r),
  ]
}
