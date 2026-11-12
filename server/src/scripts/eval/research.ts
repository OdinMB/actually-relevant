/**
 * Research measurement for multi-source stories (design rollout step 1, "Measure"): runs the
 * design's research steps on the newest published stories of the local database copy and reports
 * what each step costs, beside the researched drafts for a first look at quality.
 *
 *   npm run eval:research --prefix server -- --out ../DOCS/2026-11-12_research-eval --dry-run
 *   npm run eval:research --prefix server -- --out ../DOCS/2026-11-12_research-eval --limit 1
 *   npm run eval:research --prefix server -- --out ../DOCS/2026-11-12_research-eval --budget 3
 *
 * Reads the database through the read-only session and writes nothing to any database; its only
 * HTTP besides OpenAI is Tavily. Writes research-report.md and research-drafts.md into --out
 * (`-limit-N` for a --limit run) and its caches into --out/.cache. Prints only present/missing for
 * the keys and local/remote for the database. See .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from '../../config.js'
import { createEvalContext } from './models.js'
import { parseResearchOptions, type ResearchOptions } from './options.js'
import { classifyDb, openReadOnlyDb, readOnlyStatus } from './readOnlyDb.js'
import { deskEstimateUsd, expectedCredits, storyBudgetUsd } from './research/costs.js'
import { loadResearchFixtures, type ResearchFixtures, type ResearchStory } from './research/fixtures.js'
import { researchStory, STEP_ESTIMATES, STEPS } from './research/pipeline.js'
import { renderDrafts, renderResearchReport, researchFileNames } from './research/report.js'
import { runStories } from './research/storyQueue.js'
import { createTavilyClient, TAVILY_USD_PER_CREDIT } from './research/tavily.js'

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`
const presence = (value: string | undefined) => (value ? 'present' : 'missing')

async function getFixtures(opts: ResearchOptions, cacheDir: string): Promise<ResearchFixtures> {
  const file = join(cacheDir, 'research-fixtures.json')
  if (existsSync(file) && !opts.refreshFixtures) {
    const fx = JSON.parse(readFileSync(file, 'utf8')) as ResearchFixtures
    if (fx.size === opts.size) {
      console.log(`fixtures: cached from ${fx.createdAt} (database ${fx.dbClass}, read-only ${fx.readOnlyMode} mode); pass --refresh-fixtures to resample`)
      return fx
    }
    console.log(`fixtures: the cached sample has ${fx.size} stories, not ${opts.size}; resampling`)
  }
  console.log(`database: ${classifyDb(process.env.DATABASE_URL ?? '')}`)
  const db = await openReadOnlyDb()
  try {
    console.log(`read-only session: ${await readOnlyStatus(db)} (${db.mode} mode)`)
    const fx = await loadResearchFixtures(db, opts.size)
    writeFileSync(file, JSON.stringify(fx, null, 1))
    return fx
  } finally {
    await db.close()
  }
}

function printPlan(fx: ResearchFixtures, stories: ResearchStory[], spentUsd: number, budgetUsd: number): void {
  const count = (has: (s: ResearchStory) => boolean) => stories.filter(has).length
  console.log(`sample: ${fx.stories.length} stories published up to ${fx.anchor.slice(0, 10)}; researching ${stories.length}`)
  console.log(
    `  with cluster members ${count(s => s.clusterMembers.length > 0)}, with ±14-day neighbours ${count(s => s.neighbours.length > 0)}, ` +
      `with earlier candidates ${count(s => s.earlier.length > 0)}, non-English ${count(s => s.original.language !== 'en')}`,
  )
  for (const s of fx.shortfalls) console.log(`  shortfall: ${s}`)
  console.log('desk estimate per story:')
  for (const step of STEPS) {
    const e = STEP_ESTIMATES[step]
    console.log(`  ${step}: ${e.input} in / ${e.output} out ≈ ${usd(deskEstimateUsd(step))}${e.inDesign ? '' : ' (not in the design)'}`)
  }
  const design = STEPS.filter(s => STEP_ESTIMATES[s].inDesign).reduce((sum, s) => sum + deskEstimateUsd(s), 0)
  const all = STEPS.reduce((sum, s) => sum + deskEstimateUsd(s), 0)
  const credits = stories.reduce((sum, s) => sum + expectedCredits(s.original.language), 0)
  console.log(
    `estimate for ${stories.length} stories: model calls ${usd(design * stories.length)} (design rows) to ${usd(all * stories.length)} (a confirmation and a rewrite each); ` +
      `Tavily about ${credits} credits (${usd(credits * TAVILY_USD_PER_CREDIT)} counted as paid)`,
  )
  console.log(`folder spend so far ${usd(spentUsd)}; budget ${usd(budgetUsd)} (a cap on the folder's model ledger plus its Tavily credits)`)
}

async function main(): Promise<void> {
  const opts = parseResearchOptions(process.argv.slice(2))
  const out = resolve(opts.out)
  const cacheDir = join(out, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  console.log(`OPENAI_API_KEY: ${presence(process.env.OPENAI_API_KEY)}; TAVILY_API_KEY: ${presence(process.env.TAVILY_API_KEY)}`)

  const fx = await getFixtures(opts, cacheDir)
  const stories = opts.limit === undefined ? fx.stories : fx.stories.slice(0, opts.limit)
  const tavily = createTavilyClient({ cacheFile: join(cacheDir, 'tavily.jsonl'), apiKey: process.env.TAVILY_API_KEY, offline: opts.dryRun })
  const ctx = createEvalContext({
    cacheFile: join(cacheDir, 'calls.jsonl'),
    budgetUsd: opts.budget,
    concurrency: opts.concurrency,
    offline: opts.dryRun,
    externalSpendUsd: () => tavily.creditsRecorded() * TAVILY_USD_PER_CREDIT,
  })
  printPlan(fx, stories, ctx.spentUsd(), opts.budget)
  if (opts.dryRun) {
    console.log('dry run: no OpenAI or Tavily call made; wrote only .cache/research-fixtures.json')
    return
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing')
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY is missing')

  const relevanceMin = config.selection.relevanceMin
  const run = await runStories(stories, {
    concurrency: opts.concurrency,
    budgetUsd: opts.budget,
    spentUsd: () => ctx.spentUsd(),
    storyUsd: s => storyBudgetUsd(s.original.language),
    run: s => researchStory(s, { ctx, tavily, relevanceMin, latestDate: fx.createdAt }),
    onDone: (s, r, finished) =>
      console.log(
        `[${finished}/${stories.length}] ${s.id}: ${r.verdict.kind === 'fallback' ? `fallback (${r.verdict.reason})` : r.verdict.kind}; folder spend ${usd(ctx.spentUsd())}`,
      ),
  })
  for (const s of run.skipped) console.log(`${s.storyId}: skipped, ${s.reason}`)

  const names = researchFileNames(opts.limit)
  writeFileSync(
    join(out, names.report),
    renderResearchReport({
      generatedAt: new Date().toISOString(),
      fixtures: fx,
      stories,
      results: run.results,
      skipped: run.skipped,
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      budgetUsd: opts.budget,
      spentUsd: ctx.spentUsd(),
      thisRunUsd: ctx.spentThisRunUsd(),
      creditsRecorded: tavily.creditsRecorded(),
      relevanceMin,
    }),
  )
  writeFileSync(join(out, names.drafts), renderDrafts({ stories, results: run.results, siteUrl: config.siteUrl }))
  console.log(`wrote ${join(out, names.report)} and ${names.drafts}; Tavily requests this run: ${tavily.liveRequests()}, model calls: ${ctx.liveCalls()}`)
}

main().catch(err => {
  console.error(`research eval failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
