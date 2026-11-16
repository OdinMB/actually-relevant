/**
 * Overview evals, first increment (`.plans/2026-11-16_overview-evals.md`): the answer keys against
 * the database, production's research fact check under planted errors, and research's real cost.
 *
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --dry-run
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps keys,baseline
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps fact-check --repeat 3 --budget 3
 *
 * Reads the database through the read-only session and writes nothing to any database; its only
 * HTTP is OpenAI, for the fact check. Writes overview-eval[-tags].md into --out and its caches into
 * --out/.cache. Prints only present/missing for the key and local/remote for the database. See
 * .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createEvalContext, estimateCallUsd, type EvalContext } from './models.js'
import { parseOverviewOptions, type OverviewOptions, type OverviewStep } from './options.js'
import { classifyDb, openReadOnlyDb, readOnlyStatus, type ReadOnlyDb } from './readOnlyDb.js'
import { loadBaselineRuns, summarizeBaseline, type Baseline } from './overviews/baseline.js'
import { plannedCalls, runFactCheck } from './overviews/factCheck.js'
import { scoreArm } from './overviews/factCheckScore.js'
import { loadFactFixtures, type FactFixture, type FactFixtures } from './overviews/factFixtures.js'
import { checkKeyFiles, loadKeyStories } from './overviews/keyCheck.js'
import { readKeyFiles } from './overviews/keyFiles.js'
import { overviewReportName, renderOverviewReport, type FactCheckReport, type OverviewReportInput } from './overviews/report.js'

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)

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
    const fx = JSON.parse(readFileSync(file, 'utf8')) as FactFixtures
    if (fx.size === opts.size) {
      console.log(`fact fixtures: cached from ${fx.createdAt} (database ${fx.dbClass}); pass --refresh-fixtures to resample`)
      return fx
    }
    console.log(`fact fixtures: the cached sample has ${fx.size} facts, not ${opts.size}; resampling`)
  }
  const fx = await loadFactFixtures(await session.get(), opts.size)
  writeFileSync(file, JSON.stringify(fx, null, 1))
  return fx
}

async function factCheckStep(opts: OverviewOptions, fx: FactFixtures, facts: FactFixture[], ctx: EvalContext): Promise<FactCheckReport> {
  console.log(`fact-check: labeling ${facts.length} facts, then ${opts.arms.length} arm(s) × ${opts.repeat} run(s) on the accepted facts' variants`)
  const { labels, variants, runs } = await runFactCheck(ctx, facts, opts.arms, opts.repeat)
  console.log(`fact-check: ${labels.accepted.length} accepted, ${labels.extractionErrors.length} extraction errors; ${variants.length} variants judged`)
  const scores = runs.map(scoreArm)
  for (const s of scores) console.log(`  ${s.arm}: catch ${pct(s.catchRate)}, false rejection ${pct(s.falseRejection)}, unjudged ${s.unjudged}`)
  return { fixtures: fx, labeled: facts.length, labels, variants, ...(opts.limit !== undefined ? { limit: opts.limit } : {}), scores }
}

async function main(): Promise<void> {
  const opts = parseOverviewOptions(process.argv.slice(2))
  const out = resolve(opts.out)
  const cacheDir = join(out, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'present' : 'missing'}`)
  const runs = (step: OverviewStep) => opts.steps.includes(step)
  const ctx = createEvalContext({
    cacheFile: join(cacheDir, 'calls.jsonl'),
    budgetUsd: opts.budget,
    concurrency: opts.concurrency,
    offline: opts.dryRun || !runs('fact-check'),
  })
  const session = lazySession()
  const skipped: { step: string; reason: string }[] = []
  const failed = (step: string, err: unknown) => {
    skipped.push({ step, reason: `failed: ${err instanceof Error ? err.message : String(err)}` })
    console.error(`${step}: failed`)
    process.exitCode = 1
  }
  try {
    const keyFiles = runs('keys') ? readKeyFiles() : []
    for (const k of keyFiles) console.log(`${k.file}: ${k.errors.length === 0 ? 'format ok' : `${k.errors.length} format errors`}`)

    const fx = runs('fact-check') ? await getFactFixtures(opts, cacheDir, session) : null
    const facts = fx ? (opts.limit === undefined ? fx.facts : fx.facts.slice(0, opts.limit)) : []
    let estimate = 0
    if (fx) {
      const plan = plannedCalls(facts, opts.arms, opts.repeat)
      const uncached = plan.filter(c => !ctx.isCached(c))
      estimate = uncached.reduce((sum, c) => sum + estimateCallUsd(c), 0)
      console.log(
        `fact-check: ${facts.length} facts (newest run ${fx.anchor ?? 'none'}); at most ${plan.length} calls (${uncached.length} uncached) ≈ ${usd(estimate)}, an upper bound until the labels are known`,
      )
    }
    console.log(`folder spend so far ${usd(ctx.spentUsd())}; budget ${usd(opts.budget)} (a cap on the folder's ledger total)`)
    if (opts.dryRun) {
      console.log(`dry run: no API call made${fx ? '; wrote only .cache/fact-fixtures.json' : ''}`)
      return
    }

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
    if (fx) {
      const remaining = opts.budget - ctx.spentUsd()
      if (!process.env.OPENAI_API_KEY) skipped.push({ step: 'fact-check', reason: 'OPENAI_API_KEY is missing' })
      else if (estimate > remaining) skipped.push({ step: 'fact-check', reason: `estimate ${usd(estimate)} exceeds the remaining budget ${usd(remaining)}` })
      else {
        try {
          report.factCheck = await factCheckStep(opts, fx, facts, ctx)
        } catch (err) {
          failed('fact-check', err)
        }
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
    console.log(`wrote ${file}; model calls this run: ${ctx.liveCalls()}`)
  } finally {
    await session.close()
  }
}

main().catch(err => {
  console.error(`overview eval failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
