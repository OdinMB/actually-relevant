/**
 * Overview evals (`.plans/2026-11-16_overview-evals.md`, `.plans/2026-11-16_story-context.md`): the
 * answer keys against the database, production's research fact check under planted errors, and
 * research's real cost; and story context's gate: the gap keys drafted and checked, production's
 * first research pass replayed on their stories against the bars (its cards judged), and the fact
 * check on its facts; and a later pass's article step replayed on the answer keys' researched
 * stories with the facts found since and planted corrections (`update`), its notes judged; and the
 * overview linking replayed on the answer keys' stories in an in-memory sandbox (`link`, `found`,
 * `role`), the founded end events judged; and the overview upkeep (`pass-pool`, `stands`, `review`,
 * `recenter`, `replay`): production's first pass run in memory on the developments' must
 * entries for the facts the stands are written from, the stands at each development's checkpoints
 * judged, reviews under planted errors, the automated re-center on planted narrowed charters, the
 * anchor breach and the keys' reviewed centers, and the whole module replayed day by day for its
 * linking, checkpoints and re-centers.
 *
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --dry-run
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps keys,baseline
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_key-drafts --steps key-draft --half judge
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-17_overview-eval --steps fact-check --repeat 3 --budget 3
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_story-context-eval --steps gap-draft
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_story-context-eval --steps context,fact-check --facts context --half judge --repeat 3
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_update-eval --steps update --half judge --repeat 3
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-18_linking-eval --steps link,found,role --half tune --repeat 3
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool --half judge --dry-run
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,stands,fact-check --facts stands --half judge --budget 13
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_upkeep-eval --steps pass-pool,replay --half judge --budget 18
 *   npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_review-eval --steps recenter --half judge --budget 6
 *
 * Reads the database through the read-only session and writes nothing to any database; its only
 * HTTP is OpenAI, and Tavily for the `context` and `pass-pool` steps. Writes overview-eval[-tags].md into --out, the
 * gap-key drafts into --out/gap-drafts and its caches into --out/.cache; `key-draft`, run on its
 * own, writes its drafts into the committed answer keys for the owner's review. Prints only
 * present/missing for the keys and local/remote for the database. See .context/model-eval.md.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from '../../config.js'
import { createEvalContext, type EvalContext } from './models.js'
import { parseOverviewOptions, type OverviewOptions, type OverviewStep } from './options.js'
import { classifyDb, openReadOnlyDb, readOnlyStatus, type ReadOnlyDb } from './readOnlyDb.js'
import { createTavilyClient, TAVILY_USD_PER_CREDIT } from './research/tavily.js'
import { loadBaselineRuns, summarizeBaseline, type Baseline } from './overviews/baseline.js'
import type { CallEstimate } from './overviews/callBudget.js'
import { FIRST_PASS_RESERVE_USD, runContextStep, type ContextStepOptions, type ContextStepRun } from './overviews/context.js'
import { contextFactFixtures } from './overviews/contextFacts.js'
import {
  contextInputsFor,
  loadInputsBySlug,
  loadPassInputsBySlug,
  loadUpdateStoriesBySlug,
  PASS_INPUTS_VERSION,
  UPDATE_INPUTS_VERSION,
} from './overviews/contextInputs.js'
import { estimateFactCheck, runFactCheck } from './overviews/factCheck.js'
import { scoreArm } from './overviews/factCheckScore.js'
import { loadFactFixtures, reusableFixtures, type FactFixture, type FactFixtures } from './overviews/factFixtures.js'
import { loadGapCandidates, runGapDraftStep, type GapDraftStepOptions } from './overviews/gapDraft.js'
import { checkGapKeyFiles } from './overviews/gapKeyCheck.js'
import { checkKeyFiles, loadKeyStories } from './overviews/keyCheck.js'
import { runKeyDraftStep, type KeyDraftStepOptions } from './overviews/keyDraft.js'
import { KEYS_DIR, readGapKeyFiles, readKeyFiles } from './overviews/keyFiles.js'
import { overviewReportName, renderOverviewReport, type FactCheckReport, type FactSample, type OverviewReportInput } from './overviews/report.js'
import { runUpdateStep, type UpdateStepOptions } from './overviews/update.js'
import type { UpdateStory } from './overviews/updateFixtures.js'
import { runLinkStep } from './overviews/link.js'
import { verdict } from './overviews/linkReport.js'
import { MEMBERS_PER_CHECKPOINT, passPoolStories, runPassPool } from './overviews/passPool.js'
import { runReplayStep } from './overviews/replay.js'
import { runRecenterStep } from './overviews/recenter.js'
import { runReviewStep } from './overviews/review.js'
import { runStandsStep, standsFactFixtures, type StandsStepReport } from './overviews/stands.js'
import { nearestPublished } from '../../services/overviewCandidates.js'
import { linkStories } from '../../services/overviewInput.js'
import type { MemberFact } from '../../services/overviewStands.js'
import type { LinkStory } from '../../services/overviewTypes.js'
import { loadMemberFacts } from '../../services/passRecords.js'
import type { Db } from './readOnlyDb.js'
import { LINKING_STEPS } from './options.js'

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
const presence = (v: string | undefined) => (v ? 'present' : 'missing')
/** The steps that call a model; a run of none of them, or a dry run, is offline. */
const CALLING_STEPS: OverviewStep[] = [
  'key-draft',
  'gap-draft',
  'context',
  'update',
  'link',
  'found',
  'role',
  'pass-pool',
  'stands',
  'review',
  'recenter',
  'replay',
  'fact-check',
]

/** The stories as overview linking reads them, by slug, through the read-only session; null for a slug not published there. */
async function linkStoriesBySlug(q: Db, slugs: string[]): Promise<Map<string, LinkStory | null>> {
  const rows = slugs.length === 0 ? [] : await q.$queryRaw<{ id: string; slug: string }[]>`SELECT id, slug FROM stories WHERE slug = ANY(${slugs}::text[])`
  const stories = new Map(
    (
      await linkStories(
        q,
        rows.map(r => r.id),
      )
    ).map(s => [s.id, s]),
  )
  const idOf = new Map(rows.map(r => [r.slug, r.id]))
  return new Map(slugs.map(slug => [slug, stories.get(idOf.get(slug) ?? '') ?? null]))
}

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
  // A cache-only rerun answers every call from the cache, so it needs no key
  const canCall = Boolean(process.env.OPENAI_API_KEY) || opts.cacheOnly
  const tavily = createTavilyClient({
    cacheFile: join(cacheDir, 'tavily.jsonl'),
    apiKey: process.env.TAVILY_API_KEY,
    // A cache-only rerun searches nothing either: a search not in the cache throws, as in a dry run
    offline: opts.dryRun || opts.cacheOnly || !(runs('context') || runs('pass-pool')),
  })
  const ctx = createEvalContext({
    cacheFile: join(cacheDir, 'calls.jsonl'),
    budgetUsd: opts.budget,
    concurrency: opts.concurrency,
    offline: opts.dryRun || !CALLING_STEPS.some(runs),
    cacheOnly: opts.cacheOnly,
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
  /** A first pass's input per story slug, cached in `.cache/pass-inputs.json`: the `context` step replays the pass. */
  const passInputs = async (slugs: string[]) => {
    const r = await contextInputsFor(slugs, {
      file: join(cacheDir, 'pass-inputs.json'),
      version: PASS_INPUTS_VERSION,
      refresh: opts.refreshFixtures,
      load: async s => (await session.get()).read(q => loadPassInputsBySlug(q, s)),
    })
    console.log(`pass inputs: ${r.loaded} of ${slugs.length} loaded from the database, the rest cached`)
    return r.inputs
  }
  /** A researched story's version and pool per slug, cached in `.cache/update-inputs.json`: the `update` step replays a later pass on it. */
  const updateStories = async (slugs: string[]) => {
    const r = await contextInputsFor<UpdateStory>(slugs, {
      file: join(cacheDir, 'update-inputs.json'),
      version: UPDATE_INPUTS_VERSION,
      refresh: opts.refreshFixtures,
      load: async s => (await session.get()).read(q => loadUpdateStoriesBySlug(q, s)),
    })
    console.log(`update stories: ${r.loaded} of ${slugs.length} loaded from the database, the rest cached`)
    return r.inputs
  }
  try {
    const linking = LINKING_STEPS.some(runs)
    const upkeep = runs('replay') || runs('pass-pool') || runs('stands') || runs('review') || runs('recenter')
    const keyFiles = runs('keys') || runs('key-draft') || runs('gap-draft') || runs('update') || linking || upkeep ? readKeyFiles() : []
    if (runs('keys')) for (const k of keyFiles) console.log(`${k.file}: ${k.errors.length === 0 ? 'format ok' : `${k.errors.length} format errors`}`)
    const gapKeyFiles = runs('gap-keys') || runs('context') ? readGapKeyFiles() : []
    if (runs('gap-keys')) {
      console.log(`gap keys: ${gapKeyFiles.length} committed`)
      for (const k of gapKeyFiles) console.log(`${k.file}: ${k.errors.length === 0 ? 'format ok' : `${k.errors.length} format errors`}`)
    }
    const keyDraftOptions = (dryRun: boolean): KeyDraftStepOptions => ({
      ctx,
      files: keyFiles,
      half: opts.half,
      ...limit,
      stories: async slugs => (await session.get()).read(q => loadKeyStories(q, slugs)),
      keysDir: KEYS_DIR,
      dryRun,
      gate: { budgetUsd: opts.budget, canCall },
    })
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
      inputs: passInputs,
      relevanceMin: config.selection.relevanceMin,
      canCall,
      dryRun,
      repeat: opts.repeat,
      concurrency: opts.concurrency,
      budgetUsd: opts.budget,
      onDone: r => console.log(`context: ${r.slug} run ${r.run}: ${r.result.status}, ${r.result.outcome ?? 'no outcome'}, ${r.result.boxes.length} cards`),
    })
    const updateOptions = (dryRun: boolean): UpdateStepOptions => ({
      ctx,
      files: keyFiles,
      half: opts.half,
      ...limit,
      stories: updateStories,
      canCall,
      dryRun,
      repeat: opts.repeat,
      concurrency: opts.concurrency,
      budgetUsd: opts.budget,
      onDone: r => console.log(`update: ${r.fixture.id} run ${r.run}: ${r.result.outcome}, ${r.result.demoted.length} demoted`),
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
      if (runs('key-draft')) {
        const d = await runKeyDraftStep(keyDraftOptions(true))
        console.log(`key-draft: ${d.keys.length} version 1 keys of half ${d.half} to draft (${d.keys.join(', ') || 'none'}); ${estimateText(d.estimate)}`)
      }
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
      if (runs('update')) {
        const { report } = await runUpdateStep(updateOptions(true))
        const cases = Object.values(report.cases).reduce((a, b) => a + b, 0)
        console.log(
          `update: ${cases} cases from ${report.stories} stories × ${report.repeat} run(s); desk estimate up to ${usd(report.deskUsd ?? 0)} (each case's reserve and the note judge)`,
        )
      }
      if (runs('pass-pool')) {
        const { slugs, mustEntries } = passPoolStories(keyFiles, opts.half, opts.limit)
        console.log(
          `pass-pool: ${slugs.length} of the half's ${mustEntries} must entries (the newest ${MEMBERS_PER_CHECKPOINT} at each stands checkpoint), one first pass each; at most ${usd(slugs.length * FIRST_PASS_RESERVE_USD)} at a first pass's ceiling`,
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
    if (runs('key-draft')) {
      try {
        const d = await runKeyDraftStep(keyDraftOptions(false))
        report.keyDraft = d
        if (d.stopped) skipped.push({ step: 'key-draft', reason: d.stopped })
        for (const k of d.drafts)
          console.log(`key-draft: ${k.file}: ${k.written ? `${k.responses.length} responses drafted` : `nothing drafted (${k.outcome})`}`)
        if (d.written.length > 0) console.log('key-draft: run `npm run format --prefix server`, then review the drafts in the keys (the report lists them)')
      } catch (err) {
        failed('key-draft', err)
      }
    }
    if (runs('gap-keys')) {
      try {
        report.gapKeys = await checkGapKeyFiles(gapKeyFiles, async slugs => (await session.get()).read(q => loadKeyStories(q, slugs)))
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
    if (runs('update')) {
      if (!canCall) {
        skipped.push({
          step: 'update',
          reason: "needs OPENAI_API_KEY: each step's calls depend on the answers before them, so whether the cache holds them all is known only by running",
        })
      } else {
        try {
          const u = await runUpdateStep(updateOptions(false))
          report.update = u.report
          if (u.report.judge?.stopped) skipped.push({ step: 'update (note judge)', reason: u.report.judge.stopped })
          for (const b of u.report.score.bars)
            console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${b.met === null ? 'no verdicts' : b.met ? 'met' : 'not met'})`)
        } catch (err) {
          failed('update', err)
        }
      }
    }
    if (linking) {
      const steps = LINKING_STEPS.filter(runs).join(', ')
      if (!canCall) {
        skipped.push({
          step: steps,
          reason:
            "needs OPENAI_API_KEY: each story's calls depend on the overviews the stories before it formed, so whether the cache holds them all is known only by running",
        })
      } else {
        try {
          report.link = await runLinkStep({
            ctx,
            files: keyFiles,
            half: opts.half,
            ...limit,
            stories: async slugs => (await session.get()).read(q => linkStoriesBySlug(q, slugs)),
            neighbours: async s => (await session.get()).read(q => nearestPublished(q, s.id, s.datePublished)),
            repeat: opts.repeat,
            concurrency: opts.concurrency,
            budgetUsd: opts.budget,
          })
          if (report.link.stopped) skipped.push({ step: steps, reason: report.link.stopped })
          for (const b of [...report.link.score.link, ...report.link.score.found, ...report.link.score.role])
            console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
        } catch (err) {
          failed(steps, err)
        }
      }
    }

    // The upkeep's steps: the members' facts are the pass-pool step's pools when it ran, else the database's
    const noKey = (step: string) =>
      skipped.push({
        step,
        reason:
          "needs OPENAI_API_KEY: each day's or checkpoint's calls depend on the answers before them, so whether the cache holds them all is known only by running",
      })
    let pooled: Map<string, MemberFact[]> | null = null
    if (runs('pass-pool')) {
      if (!canCall || !process.env.TAVILY_API_KEY)
        skipped.push({ step: 'pass-pool', reason: 'needs OPENAI_API_KEY and TAVILY_API_KEY: it runs research passes' })
      else {
        try {
          const p = await runPassPool({
            ctx,
            tavily,
            files: keyFiles,
            half: opts.half,
            ...limit,
            inputs: passInputs,
            relevanceMin: config.selection.relevanceMin,
            concurrency: opts.concurrency,
            budgetUsd: opts.budget,
            spentUsd: () => ctx.spentUsd(),
          })
          pooled = p.facts
          report.passPool = p.report
          console.log(`pass-pool: ${p.report.withFacts} of ${p.report.stories} stories gave offerable facts`)
        } catch (err) {
          failed('pass-pool', err)
        }
      }
    }
    const memberFacts = async (storyIds: string[]): Promise<MemberFact[]> => {
      const held = pooled
      if (held) return storyIds.flatMap(id => held.get(id) ?? [])
      return (await (await session.get()).read(q => loadMemberFacts(q, storyIds))).map(f => ({ ...f, published: true }))
    }
    const storiesBySlug = async (slugs: string[]) => (await session.get()).read(q => linkStoriesBySlug(q, slugs))
    let standsRun: StandsStepReport | null = null
    if (runs('stands')) {
      if (!canCall) noKey('stands')
      else {
        try {
          standsRun = await runStandsStep({
            ctx,
            files: keyFiles,
            half: opts.half,
            ...limit,
            stories: storiesBySlug,
            facts: memberFacts,
            repeat: opts.repeat,
            budgetUsd: opts.budget,
          })
          report.stands = standsRun
          if (standsRun.stopped) skipped.push({ step: 'stands', reason: standsRun.stopped })
          for (const b of standsRun.score.bars) console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
        } catch (err) {
          failed('stands', err)
        }
      }
    }
    if (runs('review')) {
      if (!canCall) noKey('review')
      else {
        try {
          report.review = await runReviewStep({
            ctx,
            files: keyFiles,
            half: opts.half,
            ...limit,
            stories: storiesBySlug,
            repeat: opts.repeat,
            budgetUsd: opts.budget,
          })
          if (report.review.stopped) skipped.push({ step: 'review', reason: report.review.stopped })
          for (const b of report.review.score.bars) console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
        } catch (err) {
          failed('review', err)
        }
      }
    }
    if (runs('recenter')) {
      if (!canCall) noKey('recenter')
      else {
        try {
          report.recenter = await runRecenterStep({ ctx, files: keyFiles, half: opts.half, ...limit, stories: storiesBySlug, budgetUsd: opts.budget })
          if (report.recenter.stopped) skipped.push({ step: 'recenter', reason: report.recenter.stopped })
          for (const x of report.recenter.notRun) console.log(`recenter: not run: ${x.what}: ${x.reason}`)
          for (const b of report.recenter.score.bars) console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
        } catch (err) {
          failed('recenter', err)
        }
      }
    }
    if (runs('replay')) {
      if (!canCall) noKey('replay')
      else {
        try {
          report.replay = await runReplayStep({
            ctx,
            files: keyFiles,
            half: opts.half,
            ...limit,
            stories: storiesBySlug,
            neighbours: async (id, asOf) => (await session.get()).read(q => nearestPublished(q, id, asOf)),
            facts: memberFacts,
            repeat: opts.repeat,
            concurrency: opts.concurrency,
            budgetUsd: opts.budget,
          })
          if (report.replay.stopped) skipped.push({ step: 'replay', reason: report.replay.stopped })
          const { link, found, role } = report.replay.score.link
          for (const b of [...link, ...found, ...role]) console.log(`  ${b.name}: ${b.value === null ? 'n/a' : b.value.toFixed(3)} (${verdict(b)})`)
        } catch (err) {
          failed('replay', err)
        }
      }
    }
    if (runs('fact-check')) {
      try {
        if (fx) {
          const factCheck = await factCheckStep(opts, { source: 'research', fixtures: fx }, facts, ctx, skipped)
          if (factCheck) report.factCheck = factCheck
        } else if (opts.facts === 'stands') {
          if (!standsRun) skipped.push({ step: 'fact-check', reason: '--facts stands: the stands step did not run' })
          else {
            const sample = standsFactFixtures(standsRun.kept, opts.size)
            const factCheck = await factCheckStep(
              opts,
              { source: 'stands', facts: sample, half: opts.half },
              opts.limit === undefined ? sample.facts : sample.facts.slice(0, opts.limit),
              ctx,
              skipped,
            )
            if (factCheck) report.factCheck = factCheck
          }
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
