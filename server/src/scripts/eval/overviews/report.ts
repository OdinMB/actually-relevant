/**
 * `overview-eval.md` for `eval:overviews`: a section per step that ran (the answer keys, the gap keys
 * and their drafts, story context against its bars, a later pass's updates against theirs, overview linking against its bars, the fact check under planted errors, research's
 * cost baseline), what was skipped and why, then the spend and the fixtures' anchor. The name
 * carries a tag for every departure from the default run, so a trial never overwrites the report of
 * record. Pure.
 */
import { num, pct } from '../checks.js'
import { armKey } from '../models.js'
import { OVERVIEW_DEFAULT_ARMS, OVERVIEW_DEFAULT_SIZE, OVERVIEW_DEFAULT_STEPS, type OverviewOptions, type OverviewStep } from '../options.js'
import { TAVILY_USD_PER_CREDIT } from '../research/tavily.js'
import { WINDOW_DAYS, type Baseline, type CostStats } from './baseline.js'
import type { ContextStepReport } from './context.js'
import type { ContextFacts } from './contextFacts.js'
import { contextLines, gapDraftLines, gapKeyLines } from './contextReport.js'
import { LABEL_ARM, type CheckItem, type Labels } from './factCheck.js'
import type { FactFixtures } from './factFixtures.js'
import { CATCH_BAR, FALSE_REJECTION_BAR, MAX_LISTED, type ArmScore, type Listed } from './factCheckScore.js'
import type { GapDraftReport } from './gapDraft.js'
import type { GapKeyResult } from './gapKeyCheck.js'
import type { KeyResult } from './keyCheck.js'
import { expectedSupported, FIELD_KINDS, VARIANT_KINDS, type VariantKind } from './plant.js'
import { cell, metText, quoted, spreadText, usd } from './reportText.js'
import type { UpdateStepReport } from './update.js'
import { updateLines } from './updateReport.js'
import type { LinkStepReport } from './link.js'
import { linkLines } from './linkReport.js'
import type { PassPoolReport } from './passPool.js'
import type { ReplayStepReport } from './replay.js'
import type { ReviewStepReport } from './review.js'
import type { StandsStepReport } from './stands.js'
import { passPoolLines, replayLines, reviewLines, standsLines } from './upkeepReport.js'

export type ReportNameInput = Pick<OverviewOptions, 'steps' | 'arms' | 'size' | 'repeat' | 'limit' | 'facts' | 'half'>

const sameArms = (arms: ReportNameInput['arms']) =>
  arms.length === OVERVIEW_DEFAULT_ARMS.length && arms.every((a, i) => armKey(a) === armKey(OVERVIEW_DEFAULT_ARMS[i]!))

const defaultSteps = (steps: OverviewStep[]) => steps.length === OVERVIEW_DEFAULT_STEPS.length && steps.every((s, i) => s === OVERVIEW_DEFAULT_STEPS[i])

export function overviewReportName({ steps, arms, size, repeat, limit, facts, half }: ReportNameInput): string {
  const tags = [
    ...(defaultSteps(steps) ? [] : [`steps-${steps.join('-')}`]),
    ...(facts === 'research' ? [] : [`facts-${facts}`]),
    ...(half === 'all' ? [] : [`half-${half}`]),
    ...(sameArms(arms) ? [] : [`arms-${arms.map(armKey).join('+')}`]),
    ...(size === OVERVIEW_DEFAULT_SIZE ? [] : [`size-${size}`]),
    ...(repeat > 1 ? [`repeat-${repeat}`] : []),
    ...(limit !== undefined ? [`limit-${limit}`] : []),
  ]
  return `overview-eval${tags.map(t => `-${t}`).join('')}.md`
}

/** The facts the fact check planted errors in: research's sample from the database, the `context` step's run 1, or the `stands` step's. */
export type FactSample =
  | { source: 'research'; fixtures: FactFixtures }
  | { source: 'context'; facts: ContextFacts; half: ReportNameInput['half'] }
  | { source: 'stands'; facts: ContextFacts; half: ReportNameInput['half'] }

export interface FactCheckReport {
  sample: FactSample
  /** Facts the strong judge labeled: the sample, or its first `--limit` on a smoke run. */
  labeled: number
  labels: Labels
  /** The variants built from the accepted facts, for the arms to judge. */
  variants: CheckItem[]
  limit?: number
  scores: ArmScore[]
  /** Why the arms did not run once the labels were known (the budget, or the API key); absent when they ran. */
  stoppedArms?: string
}

export interface OverviewReportInput {
  generatedAt: string
  steps: OverviewStep[]
  keys?: KeyResult[]
  gapKeys?: GapKeyResult[]
  gapDraft?: GapDraftReport
  context?: ContextStepReport
  update?: UpdateStepReport
  /** The `link`, `found` and `role` steps' one replay. */
  link?: LinkStepReport
  passPool?: PassPoolReport
  stands?: StandsStepReport
  review?: ReviewStepReport
  /** The `closure` and `replay` steps' one replay. */
  replay?: ReplayStepReport
  factCheck?: FactCheckReport
  baseline?: Baseline
  skipped: { step: string; reason: string }[]
  thisRunUsd: number
  folderUsd: number
  budgetUsd: number
}

// ---------------------------------------------------------------------------
// Answer keys
// ---------------------------------------------------------------------------

function keyLines(keys: KeyResult[]): string[] {
  if (keys.length === 0) return ['No answer keys committed yet (`server/src/scripts/eval/overviews/keys/`).']
  const row = (k: KeyResult) => {
    const s = k.summary
    if (!s) return `| ${k.file} | (does not parse) | | | | | | | ${k.errors.length} |`
    return `| ${cell(s.title)} | ${k.file} | ${s.must} / ${s.optional} | ${s.nearMisses} | ${s.figures} | ${s.values} | ${s.closed ?? 'open'} | ${s.withResearchRun} | ${k.errors.length} |`
  }
  const withErrors = keys.filter(k => k.errors.length > 0)
  return [
    `${keys.length} keys. An error is a mistake in the key, to fix there; it passes or fails nothing in production.`,
    '',
    '| Development | File | Entries (must / optional) | Near misses | Figures | Values | Closed | Entries with a research run | Errors |',
    '|---|---|---|---|---|---|---|---|---|',
    ...keys.map(row),
    ...(withErrors.length > 0 ? ['', '### Key errors', '', ...withErrors.flatMap(k => [`**${k.file}**`, '', ...k.errors.map(e => `- ${e}`), ''])] : []),
  ]
}

// ---------------------------------------------------------------------------
// Fact check
// ---------------------------------------------------------------------------

const counted = (values: string[]) => {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

const listedLine = (l: Listed) =>
  `- ${l.kind}: ${quoted(l.text)}${l.change ? ` (${cell(l.change)})` : ''}; sentence ${quoted(l.sentence)} (${cell(l.outlet)})${l.runs > 1 ? `; in ${l.times} of ${l.runs} runs` : ''}`

function armLines(s: ArmScore, kinds: readonly VariantKind[]): string[] {
  return [
    `### ${s.arm}`,
    '',
    `${s.runs} run${s.runs === 1 ? '' : 's'}; rates pool every run.`,
    '',
    '| Kind | Expected | Items | Verdicts | Judged unsupported | Share |',
    '|---|---|---|---|---|---|',
    ...s.perKind.filter(k => kinds.includes(k.kind)).map(k => `| ${k.kind} | ${k.expected} | ${k.items} | ${k.judged} | ${k.unsupported} | ${pct(k.rate)} |`),
    '',
    `- **Catch rate** (planted errors judged unsupported): ${pct(s.catchRate)}; bar at least ${pct(CATCH_BAR)}: ${metText(s.catchMet)}.`,
    `- **False rejection** (faithful and reworded judged unsupported): ${pct(s.falseRejection)}; bar at most ${pct(FALSE_REJECTION_BAR)}: ${metText(s.falseRejectionMet)}.`,
    `- **Unjudged:** ${s.unjudged} verdicts missing (no entry in the answer, a failed call, or the budget).`,
    ...(s.spread
      ? [
          `- **Across runs:** catch rate ${spreadText(s.spread.catchRate)}; false rejection ${spreadText(s.spread.falseRejection)}.`,
          `- **Flips:** the verdict differs between runs for ${s.flips?.differing ?? 0} of ${s.flips?.stories ?? 0} items judged in every run (${pct(s.flips?.share)}).`,
        ]
      : []),
    '',
    `#### Misses (${s.misses.length} of ${s.missCount})`,
    '',
    ...(s.misses.length > 0 ? s.misses.map(listedLine) : ['None.']),
    '',
    `#### False rejections (${s.falseRejections.length} of ${s.falseRejectionCount})`,
    '',
    ...(s.falseRejections.length > 0 ? s.falseRejections.map(listedLine) : ['None.']),
    '',
  ]
}

function sampleLines(sample: FactSample): string[] {
  const facts = sample.source === 'research' ? sample.fixtures.facts : sample.facts.facts
  const outlets = new Set(facts.map(f => f.outlet)).size
  const stories = new Set(facts.map(f => f.storyId ?? f.runId)).size
  const undated = facts.filter(f => f.date === null).length
  if (sample.source === 'context') {
    const c = sample.facts
    return [
      `**Sample (module-1 facts, \`--facts context\`):** ${facts.length} facts (of ${c.size} asked for) that production's check supported in the context step's run 1, none reused, from ${stories} stories (half ${sample.half}) and ${outlets} outlets; ${undated} facts from sources without a date. Each is checked as production's \`renderFact\` renders it; the field kinds change one structured field before it is rendered again.`,
      ...c.shortfalls.map(s => `- Shortfall: ${s}`),
    ]
  }
  if (sample.source === 'stands') {
    const c = sample.facts
    return [
      `**Sample (stands lines, \`--facts stands\`):** ${facts.length} lines (of ${c.size} asked for) the stands step's run 1 kept, from ${stories} developments (half ${sample.half}); each is checked against its cited facts' source sentences, with the text kinds planted in it.`,
      ...c.shortfalls.map(s => `- Shortfall: ${s}`),
    ]
  }
  const fx = sample.fixtures
  const languages = counted(facts.map(f => f.language ?? 'unknown'))
  return [
    `**Sample:** ${facts.length} facts (of ${fx.size} asked for) from ${stories} stories and ${outlets} outlets, ${fx.runsRead} runs read back from the newest (${fx.anchor ?? 'none'}), ${fx.olderShape} of them skipped as stored in an older shape; ${undated} facts from sources without a date. Languages: ${languages.map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}.`,
    ...fx.shortfalls.map(s => `- Shortfall: ${s}`),
  ]
}

function factCheckLines(r: FactCheckReport): string[] {
  const unsupported = r.labels.unsupported
  const context = r.sample.source === 'context'
  /** Research's statements carry no structured fields to change. */
  const kinds = context ? VARIANT_KINDS : VARIANT_KINDS.filter(k => !(FIELD_KINDS as readonly string[]).includes(k))
  const shape = context
    ? "as rendered against their evidence (the source's sentence or passage, the source's date)"
    : "as extracted against their evidence (the source's sentence, what the fact measures, the source's date)"
  return [
    ...sampleLines(r.sample),
    '',
    `**Labels:** ${armKey(LABEL_ARM)} judged ${r.labeled} facts${r.limit !== undefined ? ` (the first ${r.limit} of the sample, --limit: a smoke run, not evidence)` : ''} ${shape}: ${r.labels.accepted.length} accepted, ${unsupported.length} statements their evidence does not support (${pct(r.labeled === 0 ? null : unsupported.length / r.labeled)}), ${r.labels.unlabeled.length} without a verdict. Variants are built from the accepted facts only.`,
    '',
    '| Kind | Expected | Variants |',
    '|---|---|---|',
    ...kinds.map(kind => `| ${kind} | ${expectedSupported(kind) ? 'supported' : 'unsupported'} | ${r.variants.filter(v => v.kind === kind).length} |`),
    '',
    ...(r.stoppedArms ? [`No arm ran: ${cell(r.stoppedArms)}.`, ''] : []),
    ...r.scores.flatMap(s => armLines(s, kinds)),
    `### Statements their evidence does not support (sentence, what it measures, source date): ${Math.min(unsupported.length, MAX_LISTED)} of ${unsupported.length}`,
    '',
    "Not an extraction-fidelity measure: the judge never sees the source's full text, so a statement that rightly carries scope or period from elsewhere in the article lands here too.",
    '',
    ...(unsupported.length > 0
      ? unsupported
          .slice(0, MAX_LISTED)
          .map(
            v =>
              `- ${quoted(v.item.text)}; sentence ${quoted(v.item.fact.sentence)}${v.item.fact.measures ? `; measures ${quoted(v.item.fact.measures)}` : ''} (${cell(v.item.fact.outlet)}): ${cell(v.problem) || 'no reason given'}`,
          )
      : ['None.']),
  ]
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

const statsRow = (name: string, s: CostStats) => `| ${name} | ${s.n} | ${usd(s.mean)} | ${usd(s.median)} | ${usd(s.p90)} |`

function baselineLines(b: Baseline): string[] {
  if (b.runs === 0) return ['No research runs in the database.']
  const list = (pairs: [string, number][]) => pairs.map(([k, n]) => `${k} ${n}`).join(', ')
  return [
    `${b.runs} runs in the ${WINDOW_DAYS} days to the newest run (${b.anchor}). By trigger: ${list(b.byTrigger)}. By verdict: ${list(b.byVerdict)}.`,
    '',
    '| Per run | Runs | Mean | Median | 90th percentile |',
    '|---|---|---|---|---|',
    statsRow('Cost (`cost_usd`)', b.cost),
    statsRow('Model calls', b.model),
    '',
    `Tavily credits per run: mean ${num(b.credits.mean)} (${usd(b.credits.usdMean)} at ${usd(TAVILY_USD_PER_CREDIT)} a credit, free credits counted as paid).`,
    '',
    `The cost counts the ${b.measured} runs with a stored result; ${b.unmeasured} without one (a reservation still running, or a skipped run at $0) are left out. Model calls are the cost less the credits at the price each run recorded; ${b.modelAsStored} runs record no price and count as stored.`,
  ]
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export function renderOverviewReport(input: OverviewReportInput): string {
  const sample = input.factCheck?.sample
  const fx = sample?.source === 'research' ? sample.fixtures : null
  return [
    '# Overview evals (eval:overviews)',
    '',
    `Generated ${input.generatedAt}. Steps: ${input.steps.join(', ')}.`,
    '',
    ...(input.keys ? ['## Answer keys', '', ...keyLines(input.keys), ''] : []),
    ...(input.gapKeys ? ['## Gap keys', '', ...gapKeyLines(input.gapKeys), ''] : []),
    ...(input.gapDraft ? ['## Gap-key drafts', '', ...gapDraftLines(input.gapDraft), ''] : []),
    ...(input.context ? ['## Story context against the bars', '', ...contextLines(input.context), ''] : []),
    ...(input.update ? ["## A later pass's updates against the bars", '', ...updateLines(input.update), ''] : []),
    ...(input.link ? ['## Overview linking against the bars', '', ...linkLines(input.link, input.steps), ''] : []),
    ...(input.passPool ? ["## The half's stories researched in memory (pass-pool)", '', ...passPoolLines(input.passPool), ''] : []),
    ...(input.stands ? ['## Where this stands against the bars', '', ...standsLines(input.stands), ''] : []),
    ...(input.review ? ['## Reviews under planted errors', '', ...reviewLines(input.review), ''] : []),
    ...(input.replay ? ['## The whole module replayed (closure, replay)', '', ...replayLines(input.replay, input.steps), ''] : []),
    ...(input.factCheck ? ['## Fact check under planted errors', '', ...factCheckLines(input.factCheck), ''] : []),
    ...(input.baseline ? ["## Research's cost baseline", '', ...baselineLines(input.baseline), ''] : []),
    ...(input.skipped.length > 0 ? ['## Skipped', '', ...input.skipped.map(s => `- ${s.step}: ${s.reason}`), ''] : []),
    '## Spend',
    '',
    `This run ${usd(input.thisRunUsd)}; the folder's ledger ${usd(input.folderUsd)} of the ${usd(input.budgetUsd)} budget (model calls plus Tavily credits, cached ones counted at what they cost when made).${fx ? ` Fact fixtures sampled ${fx.createdAt} from the ${fx.dbClass} database copy, anchored on its newest finished run (${fx.anchor ?? 'none'}).` : ''}`,
    '',
  ].join('\n')
}
