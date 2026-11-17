/**
 * Overview evals (`.plans/2026-11-16_overview-evals.md`, `.plans/2026-11-16_story-context.md`): the
 * answer keys against the database, production's research fact check under planted errors, and
 * research's real cost; and story context's gate: the gap keys drafted and checked, production's
 * pipeline replayed on their stories against the bars, and the fact check on its facts.
 *
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --dry-run
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps keys,baseline
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps fact-check --repeat 3 --budget 3
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_story-context-eval --steps gap-draft
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_story-context-eval --steps context,fact-check --facts context --half judge --repeat 3
 *
 * Reads the database through the read-only session and writes nothing to any database; its only
 * HTTP is OpenAI, and Tavily for the `context` step. Writes overview-eval[-tags].md into --out, the
 * gap-key drafts into --out/gap-drafts and its caches into --out/.cache. Prints only
 * present/missing for the keys and local/remote for the database. See .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createEvalContext, type EvalContext } from './models.js'
import { parseOverviewOptions, type OverviewOptions, type OverviewStep } from './options.js'
import { classifyDb, openReadOnlyDb, readOnlyStatus, type ReadOnlyDb } from './readOnlyDb.js'
import { createTavilyClient, TAVILY_USD_PER_CREDIT } from './research/tavily.js'
import { loadBaselineRuns, summarizeBaseline, type Baseline } from './overviews/baseline.js'
import type { CallEstimate } from './overviews/callBudget.js'
import { runContextStep, type ContextStepOptions, type ContextStepRun } from './overviews/context.js'
import { contextFactFixtures } from './overviews/contextFacts.js'
import { contextInputsFor, loadInputsBySlug } from './overviews/contextInputs.js'
import { estimateFactCheck, runFactCheck } from './overviews/factCheck.js'
import { scoreArm } from './overviews/factCheckScore.js'
import { loadFactFixtures, reusableFixtures, type FactFixture, type FactFixtures } from './overviews/factFixtures.js'
import { loadGapCandidates, runGapDraftStep, type GapDraftStepOptions } from './overviews/gapDraft.js'
import { checkGapKeyFiles, loadGapKeyStories } from './overviews/gapKeyCheck.js'
import { checkKeyFiles, loadKeyStories } from './overviews/keyCheck.js'
import { readGapKeyFiles, readKeyFiles } from './overviews/keyFiles.js'
import { overviewReportName, renderOverviewReport, type FactCheckReport, type FactSample, type OverviewReportInput } from './overviews/report.js'

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
const presence = (v: string | undefined) => (v ? 'present' : 'missing')
/** The steps that call a model; a run of none of them, or a dry run, is offline. */
const CALLING_STEPS: OverviewStep[] = ['gap-draft', 'context', 'fact-check']

/** The read-only session, opened on first use only: a run of the key format alone needs none. */
function lazySession() {
  let session: Promise<ReadOnlyDb> | null = null
  return {
    get(): Promise<ReadOnlyDb> {
      session ??= (async () => {
        console.log(`database: ${classifyDb(process.env.DATABASE_URL ?? '')}`)
        const db = await openReadOnlyDb()
        console.log(`read-only session: ${await readOnlyStatus(db)} (${db.mode} mode)`)
        return db
      })()
      return session
    },
    async close(): Promise<void> {
      if (session) await (await session).close()
    },
  }
}

type Session = ReturnType<typeof lazySession>

async function getFactFixtures(opts: OverviewOptions, cacheDir: string, session: Session): Promise<FactFixtures> {
  const file = join(cacheDir, 'fact-fixtures.json')
  if (existsSync(file) && !opts.refreshFixtures) {
    const fx = reusableFixtures(JSON.parse(readFileSync(file, 'utf8')), opts.size)
    if (fx) {
      console.log(`fact fixtures: cached from ${fx.createdAt} (database ${fx.dbClass}); pass --refresh-fixtures to resample`)
      return fx
    }
    console.log(`fact fixtures: the cached sample is of another size or version; resampling`)
  }
  const fx = await loadFactFixtures(await session.get(), opts.size)
  writeFileSync(file, JSON.stringify(fx, null, 1))
  return fx
}

const estimateText = (e: CallEstimate) => `${e.calls} calls (${e.uncached} uncached) ≈ ${usd(e.usd)}`

/** The step, its passes each checked against the budget; null when the label pass could not run. */
async function factCheckStep(
  opts: OverviewOptions,
  sample: FactSample,
  facts: FactFixture[],
  ctx: EvalContext,
  skipped: { step: string; reason: string }[],
): Promise<FactCheckReport | null> {
  console.log(
    `fact-check: labeling ${facts.length} ${sample.source} facts, then ${opts.arms.length} arm(s) × ${opts.repeat} run(s) on the accepted facts' variants`,
  )
  const run = await runFactCheck(ctx, facts, opts.arms, opts.repeat, { budgetUsd: opts.budget, canCall: Boolean(process.env.OPENAI_API_KEY) })
  if (run.stopped) skipped.push({ step: `fact-check (${run.stopped.pass})`, reason: run.stopped.reason })
  if (!run.labels) return null
  console.log(
    `fact-check: ${run.labels.accepted.length} accepted, ${run.labels.unsupported.length} not supported by their evidence; ${run.variants.length} variants`,
  )
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
  }
}

async function main(): Promise<void> {
  const opts = parseOverviewOptions(process.argv.slice(2))
  const out = resolve(opts.out)
  const cacheDir = join(out, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  console.log(`OPENAI_API_KEY: ${presence(process.env.OPENAI_API_KEY)}; TAVILY_API_KEY: ${presence(process.env.TAVILY_API_KEY)}`)
  const runs = (step: OverviewStep) => opts.steps.includes(step)
  const canCall = Boolean(process.env.OPENAI_API_KEY)
  const tavily = createTavilyClient({ cacheFile: join(cacheDir, 'tavily.jsonl'), apiKey: process.env.TAVILY_API_KEY, offline: opts.dryRun || !runs('context') })
  const ctx = createEvalContext({
    cacheFile: join(cacheDir, 'calls.jsonl'),
    budgetUsd: opts.budget,
    concurrency: opts.concurrency,
    offline: opts.dryRun || !CALLING_STEPS.some(runs),
    externalSpendUsd: () => tavily.creditsRecorded() * TAVILY_USD_PER_CREDIT,
  })
  const session = lazySession()
  const skipped: { step: string; reason: string }[] = []
  const failed = (step: string, err: unknown) => {
    skipped.push({ step, reason: `failed: ${err instanceof Error ? err.message : String(err)}` })
    console.error(`${step}: failed`)
    process.exitCode = 1
  }
  const limit = opts.limit !== undefined ? { limit: opts.limit } : {}
  /** Production's input per story slug, cached in `.cache/context-inputs.json`. */
  const inputs = async (slugs: string[]) => {
    const r = await contextInputsFor(slugs, {
      file: join(cacheDir, 'context-inputs.json'),
      refresh: opts.refreshFixtures,
      load: async s => (await session.get()).read(q => loadInputsBySlug(q, s)),
    })
    console.log(`context inputs: ${r.loaded} of ${slugs.length} loaded from the database, the rest cached`)
    return r.inputs
  }
  try {
    const keyFiles = runs('keys') || runs('gap-draft') ? readKeyFiles() : []
    if (runs('keys')) for (const k of keyFiles) console.log(`${k.file}: ${k.errors.length === 0 ? 'format ok' : `${k.errors.length} format errors`}`)
    const gapKeyFiles = runs('gap-keys') || runs('context') ? readGapKeyFiles() : []
    if (runs('gap-keys')) {
      console.log(`gap keys: ${gapKeyFiles.length} committed`)
      for (const k of gapKeyFiles) console.log(`${k.file}: ${k.errors.length === 0 ? 'format ok' : `${k.errors.length} format errors`}`)
    }
    const gapDraftOptions = (dryRun: boolean): GapDraftStepOptions => ({
      ctx,
      sampleFile: join(cacheDir, 'gap-sample.json'),
      refresh: opts.refreshFixtures,
      loadCandidates: async () => (await session.get()).read(loadGapCandidates),
      developmentKeys: keyFiles,
      inputs,
      draftDir: join(out, 'gap-drafts'),
      ...limit,
      dryRun,
      gate: { budgetUsd: opts.budget, canCall },
    })
    const contextOptions = (dryRun: boolean): ContextStepOptions => ({
      ctx,
      tavily,
      files: gapKeyFiles,
      half: opts.half,
      ...limit,
      inputs,
      canCall,
      dryRun,
      repeat: opts.repeat,
      concurrency: opts.concurrency,
      budgetUsd: opts.budget,
      onDone: r => console.log(`context: ${r.slug} run ${r.run}: ${r.result.status}, ${r.result.outcome ?? 'no outcome'}, ${r.result.boxes.length} cards`),
    })

    const fx = runs('fact-check') && opts.facts === 'research' ? await getFactFixtures(opts, cacheDir, session) : null
    const facts = fx ? (opts.limit === undefined ? fx.facts : fx.facts.slice(0, opts.limit)) : []
    if (fx) {
      const e = await estimateFactCheck(ctx, facts, opts.arms, opts.repeat)
      console.log(`fact-check: ${facts.length} facts (newest run ${fx.anchor ?? 'none'}); labels ${estimateText(e.labels)}`)
      console.log(
        `fact-check: arms ${estimateText(e.arms)}${e.armsUpperBound ? ', an upper bound until the labels are known (as if every fact were accepted); checked again once they are' : " on the accepted facts' variants"}`,
      )
    }
    if (runs('fact-check') && opts.facts === 'context') {
      console.log("fact-check: --facts context samples the facts the context step's run 1 keeps; each pass is checked against the budget once they are known")
    }
    if (opts.dryRun) {
      if (runs('gap-draft')) {
        const d = await runGapDraftStep(gapDraftOptions(true))
        console.log(`gap-draft: ${d.sample.length} stories sampled of ${d.candidates} candidates; drafts ${estimateText(d.estimate)}`)
      }
      if (runs('context')) {
        const { report } = await runContextStep(contextOptions(true))
        console.log(
          `context: ${report.stories} stories of ${report.keys} keys × ${report.repeat} run(s); desk estimate up to ${usd(report.deskUsd ?? 0)} (the pipeline's bound and the strong judge)`,
        )
      }
      console.log(`folder spend so far ${usd(ctx.spentUsd())}; budget ${usd(opts.budget)} (a cap on the folder's model ledger plus Tavily credits)`)
      console.log('dry run: no API call made; wrote only the samples and inputs under .cache/')
      return
    }
    console.log(`folder spend so far ${usd(ctx.spentUsd())}; budget ${usd(opts.budget)} (a cap on the folder's model ledger plus Tavily credits)`)

    const report: OverviewReportInput = {
      generatedAt: new Date().toISOString(),
      steps: opts.steps,
      skipped,
      thisRunUsd: 0,
      folderUsd: 0,
      budgetUsd: opts.budget,
    }
    if (runs('keys')) {
      try {
        report.keys = await checkKeyFiles(keyFiles, async slugs => (await session.get()).read(q => loadKeyStories(q, slugs)))
        for (const k of report.keys) console.log(`keys: ${k.file}: ${k.errors.length === 0 ? 'ok' : `${k.errors.length} errors`}`)
      } catch (err) {
        failed('keys', err)
      }
    }
    if (runs('gap-keys')) {
      try {
        report.gapKeys = await checkGapKeyFiles(gapKeyFiles, async slugs => (await session.get()).read(q => loadGapKeyStories(q, slugs)))
        for (const k of report.gapKeys) console.log(`gap-keys: ${k.file}: ${k.errors.length === 0 ? 'ok' : `${k.errors.length} errors`}`)
      } catch (err) {
        failed('gap-keys', err)
      }
    }
    if (runs('gap-draft')) {
      try {
        const d = await runGapDraftStep(gapDraftOptions(false))
        report.gapDraft = d
        if (d.stopped) skipped.push({ step: 'gap-draft', reason: d.stopped })
        console.log(
          `gap-draft: ${d.written.length} drafts written to ${join(out, 'gap-drafts')}; ${d.drafts.filter(x => x.key && x.errors.length > 0).length} with format errors`,
        )
      } catch (err) {
        failed('gap-draft', err)
      }
    }
    let contextRun: ContextStepRun | null = null
    if (runs('context')) {
      if (!canCall || !process.env.TAVILY_API_KEY) {
        skipped.push({
          step: 'context',
          reason:
            "needs OPENAI_API_KEY and TAVILY_API_KEY: each step's calls depend on the answers before them, so whether the caches hold them all is known only by running",
        })
      } else {
        try {
          contextRun = await runContextStep(contextOptions(false))
          report.context = contextRun.report
          if (contextRun.report.judge?.stopped) skipped.push({ step: 'context (judge)', reason: contextRun.report.judge.stopped })
          for (const b of contextRun.report.score.bars)
            console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${b.met === null ? 'no verdicts' : b.met ? 'met' : 'not met'})`)
        } catch (err) {
          failed('context', err)
        }
      }
    }
    if (runs('fact-check')) {
      try {
        if (fx) {
          const factCheck = await factCheckStep(opts, { source: 'research', fixtures: fx }, facts, ctx, skipped)
          if (factCheck) report.factCheck = factCheck
        } else if (!contextRun) {
          skipped.push({ step: 'fact-check', reason: '--facts context: the context step did not run' })
        } else {
          const sample = contextFactFixtures(
            contextRun.runs.filter(r => r.run === 1),
            opts.size,
          )
          const factCheck = await factCheckStep(
            opts,
            { source: 'context', facts: sample, half: opts.half },
            opts.limit === undefined ? sample.facts : sample.facts.slice(0, opts.limit),
            ctx,
            skipped,
          )
          if (factCheck) report.factCheck = factCheck
        }
      } catch (err) {
        failed('fact-check', err)
      }
    }
    if (runs('baseline')) {
      try {
        const baseline: Baseline = summarizeBaseline(await (await session.get()).read(loadBaselineRuns))
        report.baseline = baseline
        console.log(`baseline: ${baseline.runs} runs, mean cost ${baseline.cost.mean === null ? 'n/a' : usd(baseline.cost.mean)}`)
      } catch (err) {
        failed('baseline', err)
      }
    }

    const file = join(out, overviewReportName(opts))
    writeFileSync(file, renderOverviewReport({ ...report, thisRunUsd: ctx.spentThisRunUsd(), folderUsd: ctx.spentUsd() }))
    for (const s of skipped) console.log(`${s.step}: ${s.reason}`)
    console.log(`wrote ${file}; model calls this run: ${ctx.liveCalls()}; Tavily searches this run: ${tavily.liveRequests()}`)
  } finally {
    await session.close()
  }
}

main().catch(err => {
  console.error(`overview eval failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
