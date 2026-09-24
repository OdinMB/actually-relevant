/**
 * Model-comparison eval (GPT-6 migration). Orchestrates one run from CLI flags:
 *
 *   npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --dry-run
 *   npm run eval:models --prefix server -- --out ../DOCS/2026-09-24_gpt6-eval --suites related --limit 2
 *
 * Reads the database through a Postgres-enforced read-only session, calls
 * prompt builders and the production client factory directly, and writes
 * results.md, rating-sets.json and rating-key.json into --out. Never prints
 * env values or the database URL. See .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { loadFixtures, type Fixtures } from './fixtures.js'
import { classifyDb, openReadOnlyDb, readOnlyStatus } from './readOnlyDb.js'
import { armKey, createEvalContext, estimateCallUsd, type EvalContext } from './models.js'
import { parseOptions, type EvalOptions } from './options.js'
import { buildRatingDeliverable, validateRatingDeliverable } from './ratingSets.js'
import { renderResults, type ReportInput } from './resultsReport.js'
import type { Suite, SuiteResult } from './types.js'
import { preassessSuite } from './suites/preassess.js'
import { assessSuite } from './suites/assess.js'
import { dedupSuite } from './suites/dedup.js'
import { relatedSuite } from './suites/related.js'
import { socialSuite } from './suites/social.js'
import { largeTierSuite } from './suites/largeTier.js'

const SUITES: Suite[] = [preassessSuite, assessSuite, dedupSuite, relatedSuite, socialSuite, largeTierSuite]
const STALE_AFTER_DAYS = 14
const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`

async function getFixtures(opts: EvalOptions, cacheDir: string): Promise<Fixtures> {
  const file = join(cacheDir, 'fixtures.json')
  if (existsSync(file) && !opts.refreshFixtures) {
    const fx = JSON.parse(readFileSync(file, 'utf8')) as Fixtures
    if (fx.floor === opts.floor) {
      console.log(`fixtures: cached from ${fx.createdAt} (database ${fx.dbClass}, read-only ${fx.readOnlyMode} mode, floor ${fx.floor}); pass --refresh-fixtures to resample`)
      return fx
    }
    console.log(`fixtures: cached with floor ${fx.floor ?? 'unrecorded'}, requested ${opts.floor}; resampling`)
  }
  console.log(`database: ${classifyDb(process.env.DATABASE_URL ?? '')}`)
  const db = await openReadOnlyDb()
  try {
    console.log(`read-only session: ${await readOnlyStatus(db)} (${db.mode} mode)`)
    const fx = await loadFixtures(db, opts.floor)
    writeFileSync(file, JSON.stringify(fx, null, 1))
    return fx
  } finally {
    await db.close()
  }
}

function printFixtures(fx: Fixtures, suites: Suite[], limit?: number): void {
  const ageDays = (Date.now() - Date.parse(fx.anchor)) / 86_400_000
  console.log(`fixture anchor (newest assessed crawl): ${fx.anchor.slice(0, 10)}; crawl floor: ${fx.floor}`)
  if (ageDays > STALE_AFTER_DAYS) console.log(`warning: the anchor is ${Math.floor(ageDays)} days old; this database copy looks stale`)
  for (const s of suites) for (const line of s.describe(fx, limit)) console.log(`  ${line}`)
  if (fx.shortfalls.length > 0) console.log(`shortfalls:\n${fx.shortfalls.map(s => `  - ${s}`).join('\n')}`)
  if (fx.adaptations.length > 0) console.log(`adaptations:\n${fx.adaptations.map(s => `  - ${s}`).join('\n')}`)
}

function estimate(suites: Suite[], fx: Fixtures, ctx: EvalContext, limit?: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of suites) {
    const plan = s.plan(fx, limit)
    const uncached = plan.filter(c => !ctx.isCached(c))
    const usdEst = uncached.reduce((sum, c) => sum + estimateCallUsd(c), 0) + (s.extraEstimateUsd?.(fx, limit) ?? 0)
    out.set(s.name, usdEst)
    console.log(`  ${s.name}: ${plan.length} calls (${uncached.length} uncached) ≈ ${usd(usdEst)}${s.extraEstimateUsd ? ' incl. estimated judge calls' : ''}`)
  }
  return out
}

/**
 * One trivial structured-output call per arm, through the same client path as
 * the suites. Proves each model accepts `reasoning_effort` on Chat Completions
 * and that usage is metered, without needing the database.
 */
async function apiCheck(suites: Suite[], ctx: EvalContext): Promise<boolean> {
  const arms = [...new Map(suites.flatMap(s => s.arms).map(a => [armKey(a), a])).values()]
  const schema = z.object({ ok: z.boolean() })
  const records = await Promise.all(arms.map(a => ctx.call(a, 'api-check', schema, 'Return a JSON object whose "ok" field is true.')))
  for (const r of records) {
    const u = r.usage
    console.log(`  ${r.arm}: ${r.outcome}${r.finishReason ? ` (${r.finishReason})` : ''}, in ${u.input} / cached ${u.cached} / out ${u.output} / reasoning ${u.reasoning} tokens, ${usd(r.costUsd)}, ${r.latencyMs} ms${r.error ? `, error: ${r.error}` : ''}`)
  }
  return records.every(r => r.outcome === 'ok')
}

/** A call site with budget-skipped calls has no trustworthy verdict. */
function markIncomplete(result: SuiteResult): SuiteResult {
  for (const site of result.callSites) {
    const skipped = site.stats.reduce((n, s) => n + s.outcomes.skipped, 0)
    if (skipped > 0) {
      site.decision = { verdict: { kind: 'none', reasons: [`incomplete: ${skipped} calls skipped because the budget ran out`] }, passing: [] }
    }
  }
  return result
}

function writeDeliverable(out: string, results: ReportInput['suites']): ReportInput['rating'] {
  const drafts = results.flatMap(r => r.result?.ratingItems ?? [])
  const { sets, key, excluded } = buildRatingDeliverable(drafts)
  const setsFile = join(out, 'rating-sets.json')
  const keyFile = join(out, 'rating-key.json')
  writeFileSync(setsFile, JSON.stringify(sets, null, 2))
  writeFileSync(keyFile, JSON.stringify(key, null, 2))
  const validationErrors = validateRatingDeliverable(JSON.parse(readFileSync(setsFile, 'utf8')), JSON.parse(readFileSync(keyFile, 'utf8')))
  return { sets: sets.sets.map(s => ({ id: s.id, items: s.items.length })), excluded, validationErrors }
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2))
  const out = resolve(opts.out)
  const cacheDir = join(out, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'present' : 'missing'}`)
  const suites = SUITES.filter(s => opts.suites.includes(s.name))
  const ctx = createEvalContext({
    cacheFile: join(cacheDir, 'calls.jsonl'),
    budgetUsd: opts.budget,
    concurrency: opts.concurrency,
    limit: opts.limit,
    offline: opts.dryRun,
  })

  if (opts.apiCheck) {
    console.log('api check (one trivial call per arm):')
    const ok = await apiCheck(suites, ctx)
    console.log(`api check ${ok ? 'passed' : 'FAILED'}; this run ${usd(ctx.spentThisRunUsd())}, ledger ${usd(ctx.spentUsd())}`)
    if (!ok) process.exitCode = 1
    return
  }

  const fx = await getFixtures(opts, cacheDir)
  printFixtures(fx, suites, opts.limit)
  console.log('estimates:')
  const estimates = estimate(suites, fx, ctx, opts.limit)
  const total = [...estimates.values()].reduce((a, b) => a + b, 0)
  console.log(`total ≈ ${usd(total)}; ledger so far ${usd(ctx.spentUsd())}; budget ${usd(opts.budget)}`)
  if (opts.dryRun) {
    console.log('dry run: no API calls made; wrote only .cache/fixtures.json')
    return
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing')

  const results: ReportInput['suites'] = []
  for (const s of suites) {
    const est = estimates.get(s.name) ?? 0
    const remaining = opts.budget - ctx.spentUsd()
    if (est > remaining) {
      results.push({ name: s.name, result: null, skipped: `estimate ${usd(est)} exceeds the remaining budget ${usd(remaining)}` })
      console.log(`${s.name}: skipped (estimate over remaining budget)`)
      continue
    }
    console.log(`${s.name}: running`)
    try {
      results.push({ name: s.name, result: markIncomplete(await s.run(fx, ctx)) })
    } catch (err) {
      results.push({ name: s.name, result: null, skipped: `failed: ${err instanceof Error ? err.message : String(err)}` })
    }
    console.log(`${s.name}: done; this run ${usd(ctx.spentThisRunUsd())}, ledger ${usd(ctx.spentUsd())}, live calls ${ctx.liveCalls()}`)
  }

  const rating = writeDeliverable(out, results)
  const report = renderResults({
    generatedAt: new Date().toISOString(),
    fixtures: fx,
    suites: results,
    limit: opts.limit,
    budgetUsd: opts.budget,
    ledgerUsd: ctx.spentUsd(),
    thisRunUsd: ctx.spentThisRunUsd(),
    rating,
  })
  writeFileSync(join(out, 'results.md'), report)
  console.log(`wrote ${join(out, 'results.md')}, rating-sets.json, rating-key.json`)
  if (rating.validationErrors.length > 0) {
    console.error(`rating deliverable failed validation:\n${rating.validationErrors.map(e => `  - ${e}`).join('\n')}`)
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
