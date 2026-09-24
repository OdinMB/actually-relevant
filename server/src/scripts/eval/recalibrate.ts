/**
 * Phase-2 prompt recalibration check (GPT-6 migration): runs the current
 * rating and dedup prompts on gpt-6-luna and judges them against the owner's
 * acceptance rules, on the phase-1 sample cached in --out.
 *
 *   npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --half calibration --dry-run
 *   npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --half calibration --budget 5.9
 *   npm run eval:recalibrate --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --steps rating-set --budget 5.9
 *
 * Needs no database: it reads the cached fixtures and never resamples,
 * because the calibration/holdout split and the labelled dedup set are
 * defined on them. Writes recalibration-<half>.md into --out; the rating-set
 * step also swaps the full-assessment set in rating-sets.json. Never prints
 * env values. See .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Fixtures } from './fixtures.js'
import { createEvalContext, estimateCallUsd } from './models.js'
import { parseRecalibrationOptions } from './options.js'
import { sampleFor } from './recalibration.js'
import { RECALIBRATION_STEP_DEFS, type StepSection } from './recalibrationChecks.js'
import { recalibrationReportName, renderRecalibration, verdict } from './recalibrationReport.js'

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`

function readCachedFixtures(cacheDir: string, floor?: string): Fixtures {
  const file = join(cacheDir, 'fixtures.json')
  if (!existsSync(file)) throw new Error(`no cached fixtures in ${cacheDir}: the recalibration runs on the phase-1 sample, so eval:models must have sampled it there`)
  const fx = JSON.parse(readFileSync(file, 'utf8')) as Fixtures
  if (floor !== undefined && fx.floor !== floor) throw new Error(`the cached fixtures use floor ${fx.floor}, not ${floor}; the recalibration never resamples`)
  return fx
}

async function main(): Promise<void> {
  const opts = parseRecalibrationOptions(process.argv.slice(2))
  const out = resolve(opts.out)
  const cacheDir = join(out, '.cache')
  const cacheFile = join(cacheDir, 'calls.jsonl')
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'present' : 'missing'}`)
  const fx = readCachedFixtures(cacheDir, opts.floor)
  const input = { fx, sample: sampleFor(fx, opts.half), opts: { ...opts, out } }
  const ctx = createEvalContext({ cacheFile, budgetUsd: opts.budget, concurrency: opts.concurrency, limit: opts.limit, offline: opts.dryRun })
  // Cache-only: phase 1's labelled dedup set is read from the ledger and never paid for again.
  const phase1 = createEvalContext({ cacheFile, budgetUsd: 0, concurrency: opts.concurrency, offline: true })
  const steps = opts.steps.map(s => RECALIBRATION_STEP_DEFS[s])

  console.log(`fixtures: phase-1 sample from ${fx.createdAt} (floor ${fx.floor}); half: ${opts.half}`)
  for (const s of steps) if (s.preflight) console.log(`${s.name}: ${await s.preflight(input, phase1)}`)
  console.log('estimates:')
  const estimates = new Map(steps.map(s => {
    const plan = s.plan(input)
    const uncached = plan.filter(c => !ctx.isCached(c))
    const est = uncached.reduce((sum, c) => sum + estimateCallUsd(c), 0)
    console.log(`  ${s.name}: ${plan.length} calls (${uncached.length} uncached) ≈ ${usd(est)}`)
    return [s.name, est] as const
  }))
  console.log(`ledger so far ${usd(ctx.spentUsd())}; budget ${usd(opts.budget)} (a cap on the ledger total, so pass the ledger plus this run's allowance)`)
  if (opts.dryRun) {
    console.log('dry run: no API calls made')
    return
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing')

  const sections: StepSection[] = []
  const skipped: { step: string; reason: string }[] = []
  for (const s of steps) {
    const est = estimates.get(s.name) ?? 0
    const remaining = opts.budget - ctx.spentUsd()
    if (est > remaining) {
      skipped.push({ step: s.name, reason: `estimate ${usd(est)} exceeds the remaining budget ${usd(remaining)}` })
      continue
    }
    console.log(`${s.name}: running`)
    try {
      const section = await s.run(input, ctx, phase1)
      sections.push(section)
      console.log(`${s.name}: ${verdict(section.criteria)}; this run ${usd(ctx.spentThisRunUsd())}, ledger ${usd(ctx.spentUsd())}`)
    } catch (err) {
      skipped.push({ step: s.name, reason: `failed: ${err instanceof Error ? err.message : String(err)}` })
      console.error(`${s.name}: failed`)
      process.exitCode = 1
    }
  }

  const file = join(out, recalibrationReportName(opts.half, opts.effort, opts.dedupEffort))
  writeFileSync(file, renderRecalibration({
    generatedAt: new Date().toISOString(),
    half: opts.half,
    fixtures: fx,
    limit: opts.limit,
    sections,
    skipped,
    thisRunUsd: ctx.spentThisRunUsd(),
    ledgerUsd: ctx.spentUsd(),
    budgetUsd: opts.budget,
  }))
  for (const s of skipped) console.log(`${s.step}: ${s.reason}`)
  console.log(`wrote ${file}`)
}

main().catch(err => {
  console.error(`recalibration failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
