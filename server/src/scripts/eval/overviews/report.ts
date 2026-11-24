/**
 * `overview-eval.md` for `eval:overviews`: a section per step that ran (the answer keys and their
 * drafted responses, the gap keys and their drafts, story context against its bars, a later pass's updates against theirs, overview linking against its bars, the fact check under planted errors, the figure
 * check against its source, research's cost baseline), what was skipped and why, then the spend and
 * the fixtures' anchor. The name carries a tag for every departure from the default run, so a trial
 * never overwrites the report of record. The answer keys' and the baseline's sections are rendered
 * here; every other step's in its own module (`contextReport.ts`, `factCheckReport.ts`,
 * `figureCheckReport.ts`, `linkReport.ts`, `upkeepReport.ts`, …). Pure.
 */
import { num } from '../checks.js'
import { armKey } from '../models.js'
import { OVERVIEW_DEFAULT_ARMS, OVERVIEW_DEFAULT_SIZE, OVERVIEW_DEFAULT_STEPS, type OverviewOptions, type OverviewStep } from '../options.js'
import { TAVILY_USD_PER_CREDIT } from '../research/tavily.js'
import { WINDOW_DAYS, type Baseline, type CostStats } from './baseline.js'
import type { ContextStepReport } from './context.js'
import { contextLines, gapDraftLines, gapKeyLines } from './contextReport.js'
import { factCheckLines, type FactCheckReport } from './factCheckReport.js'
import type { FigureCheckResult } from './figureCheck.js'
import { figureCheckLines } from './figureCheckReport.js'
import type { GapDraftReport } from './gapDraft.js'
import type { GapKeyResult } from './gapKeyCheck.js'
import type { DuplicatesResult, KeyResult } from './keyCheck.js'
import type { KeyDraftReport } from './keyDraft.js'
import { keyDraftLines } from './keyDraftReport.js'
import { cell, usd } from './reportText.js'
import type { UpdateStepReport } from './update.js'
import { updateLines } from './updateReport.js'
import type { LinkStepReport } from './link.js'
import { linkLines } from './linkReport.js'
import type { PassPoolReport } from './passPool.js'
import type { ReplayStepReport } from './replay.js'
import type { RecenterStepReport } from './recenter.js'
import type { ReviewStepReport } from './review.js'
import type { StandsStepReport } from './stands.js'
import { passPoolLines, recenterLines, replayLines, reviewLines, standsLines } from './upkeepReport.js'

export type ReportNameInput = Pick<OverviewOptions, 'steps' | 'arms' | 'size' | 'repeat' | 'limit' | 'facts' | 'half'> &
  Partial<Pick<OverviewOptions, 'cacheOnly' | 'rescore'>>

const sameArms = (arms: ReportNameInput['arms']) =>
  arms.length === OVERVIEW_DEFAULT_ARMS.length && arms.every((a, i) => armKey(a) === armKey(OVERVIEW_DEFAULT_ARMS[i]!))

const defaultSteps = (steps: OverviewStep[]) => steps.length === OVERVIEW_DEFAULT_STEPS.length && steps.every((s, i) => s === OVERVIEW_DEFAULT_STEPS[i])

/** A cache-only rerun is tagged `cache-only`, and a rescore `rescore`, so neither overwrites the report of the run it reruns or scores again. */
export function overviewReportName({ steps, arms, size, repeat, limit, facts, half, cacheOnly, rescore }: ReportNameInput): string {
  const tags = [
    ...(defaultSteps(steps) ? [] : [`steps-${steps.join('-')}`]),
    ...(facts === 'research' ? [] : [`facts-${facts}`]),
    ...(half === 'all' ? [] : [`half-${half}`]),
    ...(sameArms(arms) ? [] : [`arms-${arms.map(armKey).join('+')}`]),
    ...(size === OVERVIEW_DEFAULT_SIZE ? [] : [`size-${size}`]),
    ...(repeat > 1 ? [`repeat-${repeat}`] : []),
    ...(limit !== undefined ? [`limit-${limit}`] : []),
    ...(cacheOnly ? ['cache-only'] : []),
    ...(rescore ? ['rescore'] : []),
  ]
  return `overview-eval${tags.map(t => `-${t}`).join('')}.md`
}

export interface OverviewReportInput {
  generatedAt: string
  steps: OverviewStep[]
  keys?: KeyResult[]
  /** The duplicate groups' check, with the keys (`checkDuplicates`). */
  duplicates?: DuplicatesResult
  keyDraft?: KeyDraftReport
  gapKeys?: GapKeyResult[]
  gapDraft?: GapDraftReport
  context?: ContextStepReport
  update?: UpdateStepReport
  /** The `link`, `found` and `role` steps' one replay. */
  link?: LinkStepReport
  passPool?: PassPoolReport
  stands?: StandsStepReport
  review?: ReviewStepReport
  recenter?: RecenterStepReport
  /** The `replay` step's replay. */
  replay?: ReplayStepReport
  factCheck?: FactCheckReport
  figureCheck?: FigureCheckResult
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
    if (!s) return `| ${k.file} | (does not parse) | | | | | | | | | | ${k.errors.length} |`
    return `| ${cell(s.title)} | ${k.file} | ${s.must} / ${s.optional} | ${s.nearMisses} | ${s.figures} | ${s.values} | ${s.responses} | ${s.withResearchRun} | ${s.eitherRoles} | ${s.toReview} | ${s.rolesToReview} | ${k.errors.length} |`
  }
  const withErrors = keys.filter(k => k.errors.length > 0)
  const toReview = keys.reduce((sum, k) => sum + (k.summary?.toReview ?? 0), 0)
  const rolesToReview = keys.reduce((sum, k) => sum + (k.summary?.rolesToReview ?? 0), 0)
  const shared = [...new Map(keys.flatMap(k => k.sharedMusts).map(s => [s.slug, s])).values()]
  return [
    `${keys.length} keys. An error is a mistake in the key, to fix there; it passes or fails nothing in production.${toReview > 0 ? ` ${toReview} drafted responses and centers are not reviewed yet (\`"reviewed": false\`): \`stands\` refuses a half that holds one, and \`link\`, \`recenter\` and \`replay\` a half that holds a center.` : ''}${rolesToReview > 0 ? ` ${rolesToReview} entr${rolesToReview === 1 ? 'y carries' : 'ies carry'} a role an AI session changed (\`roleReview\`, which says what was there and why): delete the line to keep the change, or restore what it says; no step refuses on them.` : ''}`,
    '',
    '| Development | File | Entries (must / optional) | Near misses | Figures | Values | Responses | Entries with a research run | Either role | To review | Roles to review | Errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...keys.map(row),
    ...(shared.length > 0
      ? [
          '',
          '### Must entries of more than one key',
          '',
          `${shared.length} stor${shared.length === 1 ? 'y is a must entry' : 'ies are must entries'} of more than one development. The linking eval counts a join to either one's overview as right; production files a story under one overview only.`,
          '',
          ...shared.map(s => `- ${s.slug}: ${s.keys.join(', ')}`),
        ]
      : []),
    ...(withErrors.length > 0 ? ['', '### Key errors', '', ...withErrors.flatMap(k => [`**${k.file}**`, '', ...k.errors.map(e => `- ${e}`), ''])] : []),
  ]
}

/** The duplicate groups' line under the keys: how many, the stories merged away before the linking replays, and every error. */
function duplicateLines(d: DuplicatesResult): string[] {
  return [
    '',
    '### Duplicate groups',
    '',
    `\`duplicates.json\`: ${d.groups} groups, ${d.drops} stories merged into their keeps before the linking replays (two reports of one event or study, as production's duplicate detection would have had them); ${d.errors.length === 0 ? 'no errors' : `${d.errors.length} errors, to fix in the file`}.`,
    ...(d.errors.length > 0 ? ['', ...d.errors.map(e => `- ${e}`)] : []),
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
    ...(input.keys ? ['## Answer keys', '', ...keyLines(input.keys), ...(input.duplicates ? duplicateLines(input.duplicates) : []), ''] : []),
    ...(input.keyDraft ? ["## Answer-key drafts: responses for the owner's review", '', ...keyDraftLines(input.keyDraft), ''] : []),
    ...(input.gapKeys ? ['## Gap keys', '', ...gapKeyLines(input.gapKeys), ''] : []),
    ...(input.gapDraft ? ['## Gap-key drafts', '', ...gapDraftLines(input.gapDraft), ''] : []),
    ...(input.context ? ['## Story context against the bars', '', ...contextLines(input.context), ''] : []),
    ...(input.update ? ["## A later pass's updates against the bars", '', ...updateLines(input.update), ''] : []),
    ...(input.link ? ['## Overview linking against the bars', '', ...linkLines(input.link, input.steps), ''] : []),
    ...(input.passPool ? ["## The half's stories researched in memory (pass-pool)", '', ...passPoolLines(input.passPool), ''] : []),
    ...(input.stands ? ['## Where this stands against the bars', '', ...standsLines(input.stands), ''] : []),
    ...(input.review ? ['## Reviews under planted errors', '', ...reviewLines(input.review), ''] : []),
    ...(input.recenter ? ['## Automated re-centers on planted and real cases', '', ...recenterLines(input.recenter), ''] : []),
    ...(input.replay ? ['## The whole module replayed', '', ...replayLines(input.replay), ''] : []),
    ...(input.factCheck ? ['## Fact check under planted errors', '', ...factCheckLines(input.factCheck), ''] : []),
    ...(input.figureCheck ? ['## Figure check against its source', '', ...figureCheckLines(input.figureCheck), ''] : []),
    ...(input.baseline ? ["## Research's cost baseline", '', ...baselineLines(input.baseline), ''] : []),
    ...(input.skipped.length > 0 ? ['## Skipped', '', ...input.skipped.map(s => `- ${s.step}: ${s.reason}`), ''] : []),
    '## Spend',
    '',
    `This run ${usd(input.thisRunUsd)}; the folder's ledger ${usd(input.folderUsd)} of the ${usd(input.budgetUsd)} budget (model calls plus Tavily credits, cached ones counted at what they cost when made).${fx ? ` Fact fixtures sampled ${fx.createdAt} from the ${fx.dbClass} database copy, anchored on its newest finished run (${fx.anchor ?? 'none'}).` : ''}`,
    '',
  ].join('\n')
}
