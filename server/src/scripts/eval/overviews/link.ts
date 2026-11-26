/**
 * The overview linking steps, `link`, `found` and `role` (`.context/model-eval.md`, "Overview evals";
 * plan "Evals and bars"): one replay serves all three. The answer keys of a half (`developmentHalves.ts`)
 * give their entries and near misses, replayed together in date order through production's pure
 * linking (`linkInOrder`, `linkStory`) against the in-memory sandbox (`overviewSandbox.ts`), with
 * production's prompts on the eval's cached calls at the step tiers. A judged run replays background
 * beside them (`backgroundOf`, ADR-0073): the entries of each key outside the half that shares an entry
 * with its replay, so a neighbouring development has its own stories, as in production, and its
 * look-alikes among the judged stories found no overview it would not. The whole-step replay
 * (`replay.ts`) links the same stories (`linkReplayStories`, `loadReplayed`). Neighbours come from
 * production's candidate query, read-only and as of each story's date, kept to the replayed stories;
 * the stories as linking reads them. Then the strong judge compares each development's founded end
 * event with the key's, and `linkScore.ts` scores the bars (a background story only where it joins a
 * judged development's overview), and counts how often the link calls flagged the re-center signals:
 * on a key's center entries (replayed too; the bars ignore them in their own key's overview), on base
 * near misses, and as false shifts; and `linkDiagnostics.ts` says why each missed must entry was
 * missed, which roles disagree and what each founding chartered. Each run k ≥ 2 has its own cache
 * keys. The runs go side by side, each at production's look-ahead at most, and each run's replay is
 * saved (`savedLinkReplay.ts`, ADR-0074): one scorer (`scoreSavedReplay`) turns a saved replay into
 * the report, for the paid run and for a rescore under today's keys (`rescoreLinkStep`) alike. It
 * refuses, before any read or call, while a key of its half holds a center no one has reviewed.
 */
import { basename } from 'node:path'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { linkInOrder, type LinkDeps, type ModelCall } from '../../../services/overviewLink.js'
import { overviewCalls, type OverviewCalls, type OverviewStep } from '../../../services/overviewSteps.js'
import type { LinkStory, Role } from '../../../services/overviewTypes.js'
import type { Prompt } from '../../../lib/promptCache.js'
import type { z } from 'zod'
import { arm, stoppedBySpend, versionedSchemaName } from '../models.js'
import { runNumbers, runSchemaName } from '../repeats.js'
import type { Arm, SuiteContext } from '../types.js'
import { JUDGE_ARM } from './contextJudge.js'
import { config } from '../../../config.js'
import { keysOfHalf } from './developmentHalves.js'
import { keepOf, mergedGroups, runAsKeeps, type DuplicateGroup, type MergedGroup } from './duplicates.js'
import { diagnoseRun, neighbourCount, traceOf, type NeighbourCount, type RunDiagnostics } from './linkDiagnostics.js'
import { linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, centerSlugs, type AnswerKey } from './keySchema.js'
import { scoreLinking, scoreSignals, type EndEventVerdict, type LinkScore, type ReplayRun, type SignalRunScore, type StorySignal } from './linkScore.js'
import { createSandbox, type Sandbox } from './overviewSandbox.js'
import { buildEndEventJudgePrompt, endEventJudgeSchema } from './prompts.js'
import { readSavedReplay, replayDrift, SAVED_LINK_REPLAY_VERSION, type SavedLinkReplay, type SavedLinkRun } from './savedLinkReplay.js'

/** Production's step tiers today, as the eval's arms (the overview steps' evals all take theirs from here). */
export const TIER_ARMS: Record<'small' | 'medium' | 'large', Arm> = {
  small: arm('gpt-6-luna', 'low'),
  medium: arm('gpt-6-luna', 'medium'),
  large: arm('gpt-6.1-sol', 'medium'),
}
/** A step's arm: its tier's, at the step's own effort where it has one (the audit's). */
export const stepArm = (step: OverviewStep<unknown>): Arm => ({ ...TIER_ARMS[step.tier], ...(step.effort ? { effort: step.effort } : {}) })

/** The strong judge's question on an end event: a founded one here, a re-centered one in `recenter.ts`. */
export const END_EVENT_SCHEMA = versionedSchemaName('overview-end-event-judge', endEventJudgeSchema)

export interface LinkStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  /** The stories as linking reads them, by slug (null for one not published). */
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  /** Production's neighbours of a story as of its date (`nearestPublished`, read-only). */
  neighbours(story: LinkStory): Promise<Neighbour[]>
  repeat: number
  /** Calls in flight across the runs (the eval context's own cap); within a run, link calls run ahead of the writes by production's look-ahead at most. */
  concurrency: number
  budgetUsd: number
  /** A rerun answered from the cache only (`--cache-only`): it makes no call, so it spends nothing, and the folder's recorded spend does not stop it. */
  cacheOnly?: boolean
  /** Replay only the first N stories in date order (a smoke run). */
  limit?: number
  /** The duplicate groups (`duplicates.json`, ADR-0076), merged into the keys before anything reads them. */
  groups?: readonly DuplicateGroup[]
}

/** A rescore (`--rescore`): the saved replay of the same half, repeat and limit, scored under today's keys. */
export interface RescoreOptions {
  /** Answers only from the cache: the end-event judge's verdicts of the run, where its prompt is unchanged. */
  ctx: SuiteContext
  files: KeyFile[]
  half: LinkStepOptions['half']
  repeat: number
  limit?: number
  /** The saved replay's path (`savedReplayName`). */
  file: string
  /** As `LinkStepOptions.groups`; a replay saved before a group existed is read as its keeps (`runAsKeeps`). */
  groups?: readonly DuplicateGroup[]
}

export interface LinkStepReport {
  half: LinkStepOptions['half']
  repeat: number
  limit?: number
  /** The keys replayed, and the stories replayed in all (the half's entries and near misses, and the background). */
  keys: string[]
  stories: number
  /** A judged run's background (`backgroundOf`): the keys outside the half it came from, and its stories among those replayed. */
  background: { keys: string[]; stories: number }
  /** The duplicate groups with a story among the keys replayed, each merged into its keep before the replay (ADR-0076). */
  merged: MergedGroup[]
  left: { what: string; reason: string }[]
  score: LinkScore
  endEvents: { key: string; run: number; verdict: EndEventVerdict; why: string }[]
  /** How often each run's link calls flagged the re-center signals (no bars). */
  signals: SignalRunScore[]
  /** Each run's missed must entries with why, role disagreements and founded charters (no bars). */
  diagnostics: RunDiagnostics[]
  /** Calls that got no answer because none was made: past the budget, or not in the cache with `--cache-only`. */
  unanswered: number
  /** Calls that came back `error` (a rate limit after the client's retries, among others): the first sign that too many run at once. */
  errored: number
  /** The recorded cost of the replay's calls as made (cached ones included) and the end-event judge's, and per story and run. */
  costUsd: number
  perStoryUsd: number | null
  stopped?: string
  /** A rescore's saved replay: its file, when it was saved, and the slugs today's keys ask for that it did not, and those it asked that they no longer name. */
  rescored?: { file: string; savedAt: string; added: string[]; removed: string[] }
}

/** The detail of a must entry today's keys name that the saved replay never asked for. */
const NOT_SAVED = 'not in the saved replay: the keys name it since the run'
/** Why a rescore's end-event judge gave no verdict: its call is not in the cache. */
const NOT_CACHED = "not in the cache: the key's end event, the founded one or the judge's prompt changed since the run"

/** A model call on the eval's cache, as `structuredCall` returns it to production's steps. */
export async function evalCall<T>(ctx: SuiteContext, a: Arm, schemaName: string, schema: z.ZodType<T>, prompt: Prompt, run: number): Promise<ModelCall<T>> {
  const rec = await ctx.call(a, runSchemaName(schemaName, run), schema, prompt)
  return { parsed: rec.outcome === 'ok' ? rec.parsed : null, costUsd: rec.costUsd, model: a.model }
}

/** Production's model calls of the step (`overviewCalls`) on the eval's cache, each at its step's arm, run k ≥ 2 under its own key. */
export const evalCalls = (ctx: SuiteContext, run: number): OverviewCalls =>
  overviewCalls((step, prompt) => evalCall(ctx, stepArm(step), versionedSchemaName(step.name, step.schema), step.schema, prompt, run))

/** Every slug the half's keys replay: entries (must and optional), near misses, and their centers' entries and near misses, once. */
export function replaySlugs(keys: readonly AnswerKey[]): string[] {
  return [...new Set(keys.flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug), ...centerSlugs(k)]))]
}

/**
 * The background of the half's replay (ADR-0073): each key outside the half whose own base entry the
 * replay holds adds its base entries (must and optional) that the replay does not hold yet, each slug
 * once; `keys` are those that add one. One hop only, and never a key's near misses or centers: a key
 * whose near miss is a judged story has none of its own stories there, and adding its entries, or a
 * background key's near misses, would bring look-alikes in one step further out.
 */
export function backgroundOf(keys: readonly AnswerKey[], others: readonly AnswerKey[]): { keys: AnswerKey[]; slugs: string[] } {
  const replay = new Set(replaySlugs(keys))
  const slugs = new Set<string>()
  const from: AnswerKey[] = []
  for (const k of others) {
    if (!k.entries.some(e => replay.has(e.slug))) continue
    const added = k.entries.map(e => e.slug).filter(s => !replay.has(s))
    if (added.length > 0) from.push(k)
    for (const s of added) slugs.add(s)
  }
  return { keys: from, slugs: [...slugs] }
}

/**
 * What a replay of the half loads: its keys and the others with the duplicate groups merged
 * (`keysOfHalf`), the half's slugs (`replaySlugs`), in a judged run its background (`backgroundOf`), and
 * the groups merged among the keys it replays, as they were written (`mergedGroups`). `asked` is every
 * slug a replay loads, the half's then the background's: the linking steps and the whole-step replay
 * (`replay.ts`) both load it (`loadReplayed`), so neither can leave the background out; the dry run's
 * estimates read it too.
 */
export function linkReplayStories(files: readonly KeyFile[], half: LinkStepOptions['half'], groups: readonly DuplicateGroup[] = []) {
  const { keys, others } = keysOfHalf(files, half, groups)
  const background = half === 'judge' ? backgroundOf(keys, others) : { keys: [], slugs: [] }
  const replayedKeys = new Set([...keys, ...background.keys].map(k => k.id))
  const written = files.flatMap(f => (f.key && f.errors.length === 0 && replayedKeys.has(f.key.id) ? [f.key] : []))
  const slugs = replaySlugs(keys)
  return { keys, others, slugs, asked: [...slugs, ...background.slugs], background, merged: mergedGroups(groups, written) }
}
/** What a replay of a half loads and scores against (`linkReplayStories`). */
export type ReplayStorySet = ReturnType<typeof linkReplayStories>

/**
 * The stories a replay links, read once for all its runs: those of the slugs asked that are published,
 * in date order (then by id), the first `limit` when one is set; each one's slug by its id; and the
 * slugs not published.
 */
export async function loadReplayed(
  stories: LinkStepOptions['stories'],
  asked: readonly string[],
  limit?: number,
): Promise<{ replayed: LinkStory[]; slugOf: Map<string, string>; notPublished: string[] }> {
  const loaded = await stories([...asked])
  const notPublished: string[] = []
  const slugOf = new Map<string, string>()
  const published: LinkStory[] = []
  for (const [slug, story] of loaded) {
    if (!story) notPublished.push(slug)
    else {
      slugOf.set(story.id, slug)
      published.push(story)
    }
  }
  published.sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime() || a.id.localeCompare(b.id))
  return { replayed: limit !== undefined ? published.slice(0, limit) : published, slugOf, notPublished }
}

/**
 * The linking replay's desk estimate per story and run: the 2026-11-19 paid run of the judged half
 * spent $0.3047 on 3 runs of 209 stories, the link calls, the foundings and the end-event judge together.
 */
export const LINK_DESK_USD_PER_STORY = 0.0005

/** The re-center signals the sandbox's live link decisions kept, by slug. */
export function sandboxSignals(sandbox: Sandbox, slug: (id: string) => string): StorySignal[] {
  return sandbox.decisions.flatMap(d => {
    const inputs = d.kind === 'link' && !d.undone && d.storyId ? readInputs(linkInputs, d.inputs) : null
    return inputs ? inputs.signals.map(s => ({ slug: slug(d.storyId!), overviewId: s.overviewId, kind: s.kind })) : []
  })
}

/** A key file that does not parse, or has format errors: left out of the replay. */
const keyFileErrors = (files: readonly KeyFile[]): LinkStepReport['left'] =>
  files.filter(f => !f.key || f.errors.length > 0).map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))

/** A step that replayed and scored nothing, and why. */
function refusedReport(o: Pick<LinkStepOptions, 'files' | 'half' | 'repeat'>, keys: readonly AnswerKey[], reason: string): LinkStepReport {
  return {
    half: o.half,
    repeat: o.repeat,
    keys: keys.map(k => k.id),
    stories: 0,
    background: { keys: [], stories: 0 },
    merged: [],
    left: keyFileErrors(o.files),
    score: scoreLinking(keys, []),
    endEvents: [],
    signals: [],
    diagnostics: [],
    unanswered: 0,
    errored: 0,
    costUsd: 0,
    perStoryUsd: null,
    stopped: reason,
  }
}

/**
 * The step's calls, counted as they come back: those given no answer because none was made, those
 * that came back `error`, and the recorded cost of every one (a cached call's included, so a rerun
 * from the cache still reports what the calls cost as made); and whether the budget refused one.
 */
function metered(inner: SuiteContext) {
  const meter = { unanswered: 0, errored: 0, costUsd: 0, budgetRefused: false }
  const ctx: SuiteContext = {
    ...inner,
    call: async (a, schemaName, schema, prompt) => {
      const rec = await inner.call(a, schemaName, schema, prompt)
      if (rec.outcome === 'skipped') {
        meter.unanswered++
        if (stoppedBySpend(rec.error)) meter.budgetRefused = true
      }
      if (rec.outcome === 'error') meter.errored++
      meter.costUsd += rec.costUsd
      return rec
    },
  }
  return { ctx, meter }
}

/** What every run of one replay shares: the stories in date order and their slugs, production's neighbours, the metered calls, the look-ahead and the budget. */
interface ReplayInput {
  replayed: readonly LinkStory[]
  slugOf: ReadonlyMap<string, string>
  neighbours: LinkStepOptions['neighbours']
  ctx: SuiteContext
  /** Link calls running ahead of the writes in one run. */
  lookAhead: number
  /** Whether a call may still start and a story still be written. */
  withinBudget(): boolean
}

/** One run: production's linking of the stories in date order against a sandbox of its own, its end state, traces and signals kept for the scorer. */
async function replayRun(run: number, r: ReplayInput): Promise<SavedLinkRun> {
  const sandbox = createSandbox()
  const ids = new Set(r.replayed.map(s => s.id))
  const byId = new Map(r.replayed.map(s => [s.id, s]))
  const slug = (id: string) => r.slugOf.get(id) ?? id
  // What each story's last read of its neighbours gave, before and after keeping them to the replayed stories
  const counts = new Map<string, NeighbourCount>()
  const deps: LinkDeps = {
    neighbours: async s => {
      const all = await r.neighbours(s)
      const kept = all.filter(n => ids.has(n.id))
      counts.set(s.id, neighbourCount(all, kept))
      return kept
    },
    memberships: sandbox.memberships,
    overviews: sandbox.candidateOverviews,
    stories: async wanted => wanted.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])),
    // The sandbox's clock, which the link-only replay never moves: every story may wait, as every wait counts as in force
    now: () => sandbox.context().now,
    ...evalCalls(r.ctx, run).link,
  }
  let stopped = false
  const ordered = await linkInOrder(r.replayed, deps, sandbox.apply, {
    concurrency: r.lookAhead,
    keepGoing: async () => {
      if (r.withinBudget()) return true
      stopped = true
      return false
    },
  })
  return {
    run,
    overviews: [...sandbox.overviews.values()].map(ov => ({
      id: ov.id,
      title: ov.title,
      charter: ov.charter,
      foundedFrom: [slug(ov.foundedFrom[0]), slug(ov.foundedFrom[1])],
      foundedOn: byId.get(ov.foundedFrom[1])?.date ?? '',
      members: ov.entries.map(e => slug(e.storyId)),
    })),
    roles: [...sandbox.results].flatMap(([id, x]): [string, Role][] => (x.role ? [[slug(id), x.role]] : [])),
    traces: ordered.results.map(x => traceOf(x, sandbox.results.get(x.story.id)?.outcome ?? null, counts.get(x.story.id) ?? null, slug)),
    signals: sandboxSignals(sandbox, slug),
    stopped,
  }
}

/**
 * The paid replay: the half's stories and the background replayed `repeat` times side by side, each
 * run against its own sandbox at production's look-ahead (`config.overviews.concurrency`; a lower
 * `--concurrency` lowers it too, `--concurrency 1` one call at a time), all sharing the context's cap
 * on calls in flight and its ledger, their results in run order. Then the saved replay, scored by
 * `scoreSavedReplay` as a rescore scores it; `replay` is null when the step refused.
 */
export async function runLinkStep(o: LinkStepOptions): Promise<{ report: LinkStepReport; replay: SavedLinkReplay | null }> {
  const { keys, asked } = linkReplayStories(o.files, o.half, o.groups)
  // A center's stories are replayed and its entries scored: none may be a draft no one checked
  const refused = awaitingReview(keys, 'centers')
  if (refused) return { report: refusedReport(o, keys, refused), replay: null }
  // The half's stories and the background together, in one date order: a background story is a neighbour as in production
  const { replayed, slugOf, notPublished } = await loadReplayed(o.stories, asked, o.limit)
  const { ctx, meter } = metered(o.ctx)
  const input: ReplayInput = {
    replayed,
    slugOf,
    neighbours: o.neighbours,
    ctx,
    lookAhead: Math.min(o.concurrency, config.overviews.concurrency),
    // A call the budget refused stops the runs as the spend reaching it does: the holds of the calls in flight can keep the spend just below it.
    // A cache-only rerun spends nothing, so the folder's spend, the paid run it rebuilds included, never stops it
    withinBudget: () => (o.cacheOnly === true || o.ctx.spentUsd() < o.budgetUsd) && !meter.budgetRefused,
  }
  const runs = await Promise.all(runNumbers(o.repeat).map(run => replayRun(run, input)))
  const replay: SavedLinkReplay = {
    version: SAVED_LINK_REPLAY_VERSION,
    savedAt: new Date().toISOString(),
    half: o.half,
    repeat: o.repeat,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    asked,
    notPublished,
    replayed: replayed.map(s => slugOf.get(s.id) ?? s.id),
    runs,
    unanswered: meter.unanswered,
    errored: meter.errored,
    costUsd: meter.costUsd,
  }
  return { report: await scoreSavedReplay(replay, { ctx: o.ctx, files: o.files, half: o.half, groups: o.groups }), replay }
}

/** The strong judge on each development's founded end event, per run, only where the founding names one: every call at once, the verdicts in run and key order. */
function judgeEndEvents(
  ctx: SuiteContext,
  keys: readonly AnswerKey[],
  runs: readonly ReplayRun[],
  provisional: LinkScore,
): Promise<LinkStepReport['endEvents']> {
  return Promise.all(
    provisional.runs.flatMap(r => {
      const run = runs.find(x => x.run === r.run)!
      return keys.map(async (k): Promise<LinkStepReport['endEvents'][number]> => {
        const founded = run.overviews.find(ov => ov.id === r.developments.get(k.id))
        if (!founded) return { key: k.id, run: r.run, verdict: null, why: 'no overview of it was founded' }
        if (founded.endEvent === null) return { key: k.id, run: r.run, verdict: 'none', why: 'founded with no end event: it closes by fading' }
        // A key that names no end event shows the judge none: a founding that names one is then judged against it
        const prompt = buildEndEventJudgePrompt({ development: k.title, key: k.charter.endEvent ?? 'none (it ends by fading)', founded: founded.endEvent })
        const rec = await ctx.call(JUDGE_ARM, runSchemaName(END_EVENT_SCHEMA, r.run), endEventJudgeSchema, prompt)
        if (rec.outcome === 'skipped') return { key: k.id, run: r.run, verdict: 'unjudged', why: `not judged: ${rec.error ?? 'no call was made'}` }
        const answer = rec.outcome === 'ok' ? rec.parsed : null
        return {
          key: k.id,
          run: r.run,
          verdict: answer ? (answer.same === 'yes' ? 'right' : 'wrong') : 'unjudged',
          why: answer?.why ?? 'the judge gave no answer',
        }
      })
    }),
  )
}

/**
 * The one scorer of a saved replay, for the paid run and a rescore alike (ADR-0074), under the keys
 * given: the end-event judge on each development's founded end event, the bars, the signals and the
 * diagnostics. A story the keys name that the replay never asked for is left out and, as a must
 * entry, not replayed; a story it replayed that the keys no longer name is scored as it fell. The
 * calls not made are the replay's (a judge given no answer shows on its end event); the calls that
 * failed and the cost are the replay's and the judge's. A replay saved before a duplicate group existed
 * is read as its keeps (`runAsKeeps`), so it scores the stories the merged keys name; for a replay made
 * after, that reading changes nothing.
 */
export async function scoreSavedReplay(
  stored: SavedLinkReplay,
  o: { ctx: SuiteContext; files: readonly KeyFile[]; half: LinkStepOptions['half']; groups?: readonly DuplicateGroup[] },
): Promise<LinkStepReport> {
  const { keys, others, asked, background, merged } = linkReplayStories(o.files, o.half, o.groups)
  const keep = keepOf(o.groups ?? [])
  const saved: SavedLinkReplay = { ...stored, replayed: [...new Set(stored.replayed.map(keep))], runs: stored.runs.map(r => runAsKeeps(r, keep)) }
  const { added } = replayDrift(saved, asked)
  const stillAsked = new Set(asked)
  const left = [
    ...keyFileErrors(o.files),
    ...saved.notPublished.filter(s => stillAsked.has(s)).map(what => ({ what, reason: 'not published in this database' })),
    ...added.map(what => ({ what, reason: NOT_SAVED })),
  ]
  const runs: ReplayRun[] = saved.runs.map(r => ({
    run: r.run,
    overviews: r.overviews.map(ov => ({
      id: ov.id,
      members: ov.members,
      foundedFrom: ov.foundedFrom,
      endEvent: ov.charter.endEvent,
      title: ov.title,
      foundedOn: ov.foundedOn,
    })),
    roles: new Map(r.roles),
  }))
  const replayed = new Set(saved.replayed)
  const provisional = scoreLinking(keys, runs, new Map(), others)
  const { ctx, meter } = metered(o.ctx)
  const endEvents = await judgeEndEvents(ctx, keys, runs, provisional)
  const verdicts = new Map(keys.map(k => [k.id, runs.map(r => endEvents.find(e => e.key === k.id && e.run === r.run)?.verdict ?? null)]))
  const absent = new Map(added.map(s => [s, NOT_SAVED]))
  const stopped = saved.runs.filter(r => r.stopped).map(r => r.run)
  const costUsd = saved.costUsd + meter.costUsd
  return {
    half: o.half,
    repeat: saved.repeat,
    ...(saved.limit !== undefined ? { limit: saved.limit } : {}),
    keys: keys.map(k => k.id),
    stories: saved.replayed.length,
    background: { keys: background.keys.map(k => k.id), stories: background.slugs.filter(s => replayed.has(s)).length },
    merged,
    left,
    score: scoreLinking(keys, runs, verdicts, others),
    endEvents,
    signals: provisional.runs.map(r => scoreSignals(keys, replayed, saved.runs.find(x => x.run === r.run)?.signals ?? [], r.developments, r.run)),
    diagnostics: saved.runs.map(r =>
      diagnoseRun({
        keys,
        others,
        run: r.run,
        overviews: r.overviews,
        traces: new Map(r.traces.map(t => [t.slug, t])),
        roles: new Map(r.roles),
        replayed,
        neighbourLimit: config.overviews.neighbourLimit,
        absent,
      }),
    ),
    unanswered: saved.unanswered,
    errored: saved.errored + meter.errored,
    costUsd,
    perStoryUsd: saved.replayed.length === 0 || runs.length === 0 ? null : costUsd / (saved.replayed.length * runs.length),
    ...(stopped.length > 0
      ? { stopped: `the budget ran out in run${stopped.length === 1 ? '' : 's'} ${stopped.join(', ')}: the stories after that point were not linked` }
      : {}),
  }
}

/**
 * `--rescore`: the saved replay of the same half, repeat and limit, scored again under today's keys
 * and scorer (`scoreSavedReplay`), with no model call and no database. The end-event judge asks the
 * cache only: the run's verdict where its prompt is unchanged, none where it changed. Refused while a
 * key of the half holds a center no one has reviewed, and for a file missing or of another version.
 */
export async function rescoreLinkStep(o: RescoreOptions): Promise<LinkStepReport> {
  const { keys, asked } = linkReplayStories(o.files, o.half, o.groups)
  const refused = awaitingReview(keys, 'centers')
  if (refused) return refusedReport(o, keys, refused)
  const read = readSavedReplay(o.file)
  if ('refused' in read) return refusedReport(o, keys, read.refused)
  const ctx: SuiteContext = {
    ...o.ctx,
    call: async (a, schemaName, schema, prompt) => {
      const rec = await o.ctx.call(a, schemaName, schema, prompt)
      return rec.outcome === 'skipped' ? { ...rec, error: NOT_CACHED } : rec
    },
  }
  const report = await scoreSavedReplay(read.replay, { ctx, files: o.files, half: o.half, groups: o.groups })
  return { ...report, rescored: { file: basename(o.file), savedAt: read.replay.savedAt, ...replayDrift(read.replay, asked) } }
}
