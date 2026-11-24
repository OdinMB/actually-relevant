/**
 * The two steps of `eval:overviews` that sample what the run's earlier steps left, as the CLI runs
 * them: the fact check under planted errors (`fact-check`) and the figure check (`figure-check`). For
 * each: its sample for `--facts` (`factSources.ts`), its passes each checked against the budget, its
 * console lines, and what it leaves for the report and the skipped list. The steps themselves are
 * `factCheck.ts` (with `factDrift.ts`) and `figureCheck.ts`; this is only how the CLI drives them,
 * kept out of the CLI's `main`.
 */
import { pct } from '../checks.js'
import type { EvalContext } from '../models.js'
import { OVERVIEW_FACT_SOURCES, type OverviewOptions } from '../options.js'
import { estimateText } from './callBudget.js'
import { runFactCheck } from './factCheck.js'
import type { FactCheckReport } from './factCheckReport.js'
import { scoreArm, scoreFidelity } from './factCheckScore.js'
import { runDriftPass } from './factDrift.js'
import type { FactFixture } from './factFixtures.js'
import { FACT_SAMPLERS, figureInput, sampledFacts, type FactSample, type SampledRuns } from './factSources.js'
import { runFigureCheckStep, type FigureCheckInput, type FigureCheckResult } from './figureCheck.js'
import { verdict } from './linkReport.js'
import type { Bar } from './linkScore.js'

/** Where a step says what it did not do, and how a thrown step is recorded (the CLI's). */
export interface StepLog {
  skipped: { step: string; reason: string }[]
  failed(step: string, err: unknown): void
}

const printBars = (bars: Bar[]) => {
  for (const b of bars) console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
}

const gateOf = (opts: OverviewOptions) => ({ budgetUsd: opts.budget, canCall: Boolean(process.env.OPENAI_API_KEY) })

/** The fact check, its passes each checked against the budget; null when the label pass could not run. */
async function factCheckStep(
  opts: OverviewOptions,
  sample: FactSample,
  facts: FactFixture[],
  ctx: EvalContext,
  skipped: StepLog['skipped'],
): Promise<FactCheckReport | null> {
  console.log(
    `fact-check: labeling ${facts.length} ${sample.source} facts, then ${opts.arms.length} arm(s) × ${opts.repeat} run(s) on the accepted facts' variants`,
  )
  const gate = gateOf(opts)
  const run = await runFactCheck(ctx, facts, opts.arms, opts.repeat, gate)
  if (run.stopped) skipped.push({ step: `fact-check (${run.stopped.pass})`, reason: run.stopped.reason })
  if (!run.labels) return null
  const rendered = OVERVIEW_FACT_SOURCES[sample.source].rendered
  console.log(
    `fact-check: ${run.labels.accepted.length} accepted, ${run.labels.unsupported.length} not supported by their evidence; ${run.variants.length} variants`,
  )
  // Rendered module-1 facts: a second pass sorts the facts the labels rejected, and the two together measure the rendering itself
  const drift = rendered ? await runDriftPass(ctx, run.labels.unsupported, gate) : null
  if (drift) {
    // The unjudged count beside the shares: a failed or skipped call's facts count as not faithful, which lowers both
    const count = (category: 'context' | 'changed' | null) => drift.readings?.filter(r => r.category === category).length ?? 0
    const sorted = drift.readings ? `${count('context')} context, ${count('changed')} changed, ${count(null)} unjudged (counted as not faithful)` : 'not run'
    console.log(`fact-check: second pass on the ${run.labels.unsupported.length} rejected facts: ${estimateText(drift.estimate)}; ${sorted}`)
  }
  if (drift?.stopped) skipped.push({ step: 'fact-check (second pass)', reason: drift.stopped })
  const fidelity = drift ? scoreFidelity(run.labels, drift.readings) : null
  printBars(fidelity?.bars ?? [])
  const scores = run.runs.map(scoreArm)
  for (const s of scores) console.log(`  ${s.arm}: catch ${pct(s.catchRate)}, false rejection ${pct(s.falseRejection)}, unjudged ${s.unjudged}`)
  return {
    sample,
    labeled: facts.length,
    labels: run.labels,
    variants: run.variants,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    scores,
    ...(run.stopped?.pass === 'arms' ? { stoppedArms: run.stopped.reason } : {}),
    ...(drift?.stopped ? { stoppedDrift: drift.stopped } : {}),
    ...(fidelity ? { fidelity } : {}),
  }
}

/** The figure check on run 1's figures, its passes each checked against the budget: its estimate, production against the labels and its bars to the console. */
async function figureCheckStep(opts: OverviewOptions, input: FigureCheckInput, ctx: EvalContext, skipped: StepLog['skipped']): Promise<FigureCheckResult> {
  const r = await runFigureCheckStep(ctx, input, {
    size: opts.size,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    arms: opts.arms,
    repeat: opts.repeat,
    gate: gateOf(opts),
  })
  const bound = r.estimate.armsUpperBound ? ', an upper bound until the labels were known' : ''
  console.log(
    `figure-check: ${r.labeled} figures of ${r.sample.stories} stories; labels ${estimateText(r.estimate.labels)}; arms ${estimateText(r.estimate.arms)}${bound}`,
  )
  if (r.stopped) skipped.push({ step: `figure-check (${r.stopped.pass})`, reason: r.stopped.reason })
  const a = r.score.agreement
  if (a)
    console.log(
      `figure-check: the judge finds ${pct(a.kept.share)} of ${a.kept.labeled} kept figures not given, ${pct(a.removed.share)} of ${a.removed.labeled} removed ones given`,
    )
  printBars(r.score.bars)
  return r
}

/**
 * Runs the sampling steps `--steps` names, the fact check and then the figure check, on what the
 * earlier steps left (`runs`). A step whose source step did not run is skipped with the reason; one
 * that throws is recorded as failed and the other still runs.
 */
export async function runSamplingSteps(
  opts: OverviewOptions,
  runs: SampledRuns,
  ctx: EvalContext,
  log: StepLog,
): Promise<{ factCheck?: FactCheckReport; figureCheck?: FigureCheckResult }> {
  const out: { factCheck?: FactCheckReport; figureCheck?: FigureCheckResult } = {}
  const source = OVERVIEW_FACT_SOURCES[opts.facts]
  if (opts.steps.includes('fact-check')) {
    try {
      const sample = FACT_SAMPLERS[opts.facts](runs, opts.size, opts.half)
      if (!sample) {
        log.skipped.push({
          step: 'fact-check',
          reason: source.step ? `--facts ${opts.facts}: the ${source.step} step did not run` : `--facts ${opts.facts}: no sample was loaded`,
        })
      } else {
        const sampled = sampledFacts(sample)
        const factCheck = await factCheckStep(opts, sample, opts.limit === undefined ? sampled : sampled.slice(0, opts.limit), ctx, log.skipped)
        if (factCheck) out.factCheck = factCheck
      }
    } catch (err) {
      log.failed('fact-check', err)
    }
  }
  if (opts.steps.includes('figure-check')) {
    try {
      // The flags refuse figure-check without a --facts source of rendered facts: no input here means its step did not run
      const input = figureInput(opts.facts, runs, opts.half)
      if (!input) log.skipped.push({ step: 'figure-check', reason: `--facts ${opts.facts}: the ${source.step ?? 'sampled'} step did not run` })
      else out.figureCheck = await figureCheckStep(opts, input, ctx, log.skipped)
    } catch (err) {
      log.failed('figure-check', err)
    }
  }
  return out
}
