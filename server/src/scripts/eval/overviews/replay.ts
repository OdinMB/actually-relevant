/**
 * The `replay` step (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): one replay
 * of the whole module per development, over exactly the linking steps' stories (`linkReplayStories`,
 * `loadReplayed`): the half's (entries, near misses, and their centers' stories) and, in a judged run,
 * the background's (ADR-0073, ADR-0081), so a neighbouring development has its own stories and overview
 * as in production. Each day runs the job's night (`runNight`) over the sandbox (`overviewSandbox.ts`,
 * `upkeepSandbox.ts`) with the day as its clock: the stories published by then and owed by production's
 * rule (`owedOf`, `owedSlices`: a held, failed or conflicting one linked again when it is due) are
 * linked in date order, then production's upkeep runs (`runUpkeep`) over every overview, the
 * background's too: the status machine, re-centers, reviews and the stands, on the eval's cached calls
 * at the step tiers. No background overview's review is skipped: a review sets its scope, detaches
 * entries, narrows its charter and lifts a burst's freeze, which the judged stories' later link calls
 * read. The days run on past the last story for one quiet period (`TAIL_DAYS`).
 * Each development is looked at on its checkpoint days; `replayScore.ts` scores the bars. The signal
 * fires the automated re-center as in production: each applied one is recorded with its day. Each
 * run's end is diagnosed as the linking steps' runs are (`diagnoseRun`), from each story's last link
 * result, with why a story that had joined is in no overview at the end. The members' facts are given
 * by the runner: the `pass-pool` step's pools, or the database's. Each run k ≥ 2 has its own cache
 * keys. It refuses, before any read or call, while a key of its half holds a center no one has
 * reviewed (`awaitingReview`).
 */
import { config } from '../../../config.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import type { LinkDeps, LinkResult } from '../../../services/overviewLink.js'
import { runNight } from '../../../services/overviewNight.js'
import { owedSlices } from '../../../services/overviewOwed.js'
import { standsFacts, type MemberFact } from '../../../services/overviewStands.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { runNumbers } from '../repeats.js'
import type { SuiteContext } from '../types.js'
import type { DuplicateGroup } from './duplicates.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, type AnswerKey } from './keySchema.js'
import { evalCalls, linkReplayStories, loadReplayed } from './link.js'
import { diagnoseRun, neighbourCount, traceOf, type FoundedOverview, type NeighbourCount, type RunDiagnostics } from './linkDiagnostics.js'
import { linkKeys, overviewTitled, type LinkKeys } from './linkScore.js'
import { entryRole } from '../../../services/overviewCases.js'
import { activeEntries, createSandbox, owedOf, type Sandbox, type SandboxDecision } from './overviewSandbox.js'
import { readInputs, recenterInputs } from '../../../services/overviewDecisions.js'
import {
  checkpointsOf,
  developmentBefore,
  scoreReplay,
  splitsOf,
  type CheckpointState,
  type ReplayRecenter,
  type ReplayRunResult,
  type ReplayScore,
} from './replayScore.js'
import { sandboxUpkeep } from './upkeepSandbox.js'

/** Days the replay runs on past the last story: one quiet period, so the end state still shows the status machine (and the reviews it brings) after the last story. */
export const TAIL_DAYS = config.overviews.quietAfterDays

const DAY_MS = 86_400_000
/** The day `n` days after `day` (`YYYY-MM-DD`, UTC). */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
/** The last day a replay runs, from its last story's day: one quiet period on (`TAIL_DAYS`). The dry run's estimate ends there too. */
export const lastReplayDay = (lastStoryDay: string): string => addDays(lastStoryDay, TAIL_DAYS)

export interface ReplayStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  /** Production's neighbours of a story as of a day (`nearestPublished`, read-only). */
  neighbours(storyId: string, asOf: Date): Promise<Neighbour[]>
  /** The usable, structured facts of these stories' pools (the `pass-pool` step's, or the database's). */
  facts(storyIds: string[]): Promise<MemberFact[]>
  repeat: number
  concurrency: number
  budgetUsd: number
  limit?: number
  /** The duplicate groups, merged into the keys before the replay reads them (`keysOfHalf`, ADR-0076). */
  groups?: readonly DuplicateGroup[]
}

export interface ReplayStepReport {
  half: ReplayStepOptions['half']
  repeat: number
  limit?: number
  keys: string[]
  /** Every story replayed, the background's included. */
  stories: number
  /** A judged run's background (`backgroundOf`): the keys outside the half it came from, and its stories among those replayed. */
  background: { keys: string[]; stories: number }
  left: { what: string; reason: string }[]
  runs: ReplayRunResult[]
  score: ReplayScore
  /** Each run's missed must entries with why, role disagreements and founded charters, as the linking steps diagnose theirs (no bars). */
  diagnostics: RunDiagnostics[]
  costUsd: number
  stopped?: string
}

/** A development's checkpoint: its key, which of the three, and the day. */
type Checkpoint = { key: AnswerKey; at: CheckpointState['at']; day: string }

/** What every run of one replay shares: the keys and their reading, the stories in date order with their slugs, the members' facts, the checkpoints by day, and the runner's reads and limits. */
interface ReplayInput {
  keys: readonly AnswerKey[]
  others: readonly AnswerKey[]
  /** The keys read as the link bars read them (`linkKeys`): an overview stands for a development of any key. */
  index: LinkKeys
  replayed: readonly LinkStory[]
  byId: ReadonlyMap<string, LinkStory>
  slugOf: (id: string) => string
  replayedSlugs: ReadonlySet<string>
  facts: (storyIds: string[]) => MemberFact[]
  checkpoints: ReadonlyMap<string, Checkpoint[]>
  /** The last day replayed (`lastReplayDay`). */
  lastDay: string
  neighbours: ReplayStepOptions['neighbours']
  ctx: ReplayStepOptions['ctx']
  /** Link calls running ahead of the writes in one night. */
  lookAhead: number
  budgetUsd: number
}

/** A key's development at a checkpoint: the overview most of its must entries published by then are active in. */
function checkpoint(sandbox: Sandbox, r: Pick<ReplayInput, 'index' | 'slugOf' | 'facts'>, c: Checkpoint): CheckpointState {
  const must = new Set(c.key.entries.filter(e => e.join === 'must' && e.date <= c.day).map(e => e.slug))
  let best: { id: string; found: number } | null = null
  for (const o of sandbox.overviews.values()) {
    const found = activeEntries(o).filter(e => must.has(r.slugOf(e.storyId))).length
    if (found > 0 && (!best || found > best.found)) best = { id: o.id, found }
  }
  const o = best ? sandbox.overviews.get(best.id)! : null
  const active = o ? activeEntries(o) : []
  const members = active.map(e => r.slugOf(e.storyId))
  const development = o ? r.index.standsFor(members) : null
  return {
    key: c.key.id,
    at: c.at,
    day: c.day,
    overview: o ? { id: o.id, title: o.title, development, status: o.status, scope: o.scope, frozen: o.frozen } : null,
    mustByThen: must.size,
    mustFound: best?.found ?? 0,
    // Read as the joins bar reads them, so the checkpoints and the bar never disagree on a member
    wrongMembers: development === c.key.id ? members.filter(slug => r.index.verdict(slug, c.key.id) === 'wrong').map(slug => r.index.named(slug)) : [],
    offerable: standsFacts(r.facts(active.map(e => e.storyId)), c.day).length,
    stands: o?.stands ? { sentences: o.stands.sentences.length, doing: o.stands.doing.length } : null,
  }
}

/** The automated re-centers applied among these decisions, each with the development its overview stood for when it was decided (`developmentBefore`) and the stories it took in. */
export function recentersOf(
  decisions: readonly SandboxDecision[],
  sandbox: Pick<Sandbox, 'overviews'>,
  r: Pick<ReplayInput, 'index' | 'slugOf'>,
  day: string,
): ReplayRecenter[] {
  return decisions.flatMap(d => {
    const ov = d.kind === 'recenter' && d.outcome === 'recentered' && d.overviewId ? sandbox.overviews.get(d.overviewId) : undefined
    if (!ov) return []
    const inputs = readInputs(recenterInputs, d.inputs)
    const joined = (inputs?.joined ?? []).map(id => r.slugOf(id))
    const detached = new Set(inputs?.detached ?? [])
    // Its members as the re-center found them: those active now and the entries it detached (the stories it took in are left out by `developmentBefore`)
    const found = ov.entries.filter(e => e.status === 'active' || detached.has(e.id)).map(e => r.slugOf(e.storyId))
    const development = developmentBefore(found, joined, r.index.standsFor)
    const nearMissesJoined = joined.filter(s => development !== null && (r.index.nearMiss.get(s) ?? []).includes(development))
    return [{ overviewId: ov.id, day, development, title: ov.title, joined, nearMissesJoined }]
  })
}

/** The overviews a run ended with, by slug: founding pair and day, charter and active members. The bars and the diagnostics both read these. */
function foundedOverviews(sandbox: Sandbox, r: Pick<ReplayInput, 'byId' | 'slugOf'>): FoundedOverview[] {
  return [...sandbox.overviews.values()].map(ov => ({
    id: ov.id,
    title: ov.title,
    charter: ov.charter,
    foundedFrom: [r.slugOf(ov.foundedFrom[0]), r.slugOf(ov.foundedFrom[1])],
    foundedOn: r.byId.get(ov.foundedFrom[1])?.date ?? '',
    members: activeEntries(ov).map(e => r.slugOf(e.storyId)),
  }))
}

const DETACHED_BY: Record<string, string> = { review: 'a review', recenter: 'a re-center' }

/**
 * Why each story the upkeep took out of an overview is out, by slug: the overview it left by its title
 * and the development it stands for now, what took it out, and the day. The diagnostics read it only
 * for a story active in no overview at the end.
 */
function detachedOf(sandbox: Sandbox, r: Pick<ReplayInput, 'index' | 'slugOf'>): Map<string, string> {
  const why = new Map<string, string>()
  for (const ov of sandbox.overviews.values()) {
    const development = r.index.standsFor(activeEntries(ov).map(e => r.slugOf(e.storyId)))
    for (const e of ov.entries.filter(x => x.status === 'detached')) {
      const by = e.detachReason ? (DETACHED_BY[e.detachReason] ?? e.detachReason) : 'the upkeep'
      const on = e.detachedAt ? ` on ${e.detachedAt.toISOString().slice(0, 10)}` : ''
      why.set(r.slugOf(e.storyId), `from ${overviewTitled(ov.title, development)} by ${by}${on}`)
    }
  }
  return why
}

/**
 * One run: a sandbox of its own, each day's night (the owed stories linked, then the upkeep) to the
 * last day or until the budget is spent, the checkpoints looked at on their days, and the end state
 * read for the bars and diagnosed. `stopped` says where the budget ended it.
 */
async function replayOneRun(run: number, r: ReplayInput): Promise<{ result: ReplayRunResult; diagnostics: RunDiagnostics; stopped?: string }> {
  const runStart = r.ctx.spentUsd()
  const sandbox = createSandbox()
  let clock = new Date(0)
  let stopped: string | undefined
  /** A story's neighbours as of a day (the runner's read): all of them, and those kept to the replayed stories. */
  const read = async (id: string, asOf: Date) => {
    const all = r.byId.has(id) ? await r.neighbours(id, asOf) : []
    return { all, kept: all.filter(n => r.byId.has(n.id)) }
  }
  // A re-center reads its neighbours as of the development clock, as production does
  const upkeep = sandboxUpkeep(
    sandbox,
    r.facts,
    () => clock,
    async (id, asOf) => (await read(id, asOf)).kept,
  )
  const { link: linkCalls, ...calls } = evalCalls(r.ctx, run)
  const safeguards: Record<string, number> = {}
  const add = (name: string, n: number) => {
    if (n > 0) safeguards[name] = (safeguards[name] ?? 0) + n
  }
  // Each story's last link result across the nights, and what its last read of its neighbours gave: the diagnostics' traces
  const lastResults = new Map<string, LinkResult>()
  const counts = new Map<string, NeighbourCount>()
  const storiesOf = async (wanted: string[]) => wanted.flatMap(id => (r.byId.has(id) ? [r.byId.get(id)!] : []))
  const deps: LinkDeps = {
    // Linking reads them as of the story's own date
    neighbours: async s => {
      const { all, kept } = await read(s.id, s.datePublished)
      counts.set(s.id, neighbourCount(all, kept))
      return kept
    },
    memberships: sandbox.memberships,
    overviews: sandbox.candidateOverviews,
    stories: storiesOf,
    now: () => clock,
    ...linkCalls,
  }
  const keepGoing = async () => {
    if (r.ctx.spentUsd() < r.budgetUsd) return true
    stopped ??= `the budget ran out in run ${run}: the days after it were not replayed`
    return false
  }
  const states: CheckpointState[] = []
  const recenters: ReplayRecenter[] = []
  for (let day = r.replayed[0]!.date; day <= r.lastDay && !stopped; day = addDays(day, 1)) {
    clock = new Date(`${day}T23:59:59Z`)
    sandbox.setClock(clock)
    const written = sandbox.decisions.length
    // The job's night over the sandbox: the stories published by today and owed by production's rule (a held, failed or conflicting one again when it is due), then the upkeep
    const night = await runNight(
      {
        owed: async () =>
          owedSlices(
            owedOf(
              sandbox,
              r.replayed.filter(s => s.date <= day),
              clock,
            ),
            clock,
          ),
        stories: storiesOf,
        link: deps,
        apply: sandbox.apply,
        upkeep: { ...upkeep, ...calls },
      },
      { now: clock, today: day },
      { concurrency: r.lookAhead, keepGoing },
    )
    for (const x of night.run.results) lastResults.set(x.story.id, x)
    add(
      'link yeses refused by code',
      night.run.results.reduce((s, x) => s + x.refusals.length, 0),
    )
    add('foundings not agreed', night.run.results.filter(x => x.founding && x.founding.outcome !== 'founded').length)
    add('stories given up after their last try', night.givenUp.length)
    add('upkeep items failed', night.upkeep?.failed ?? 0)
    recenters.push(...recentersOf(sandbox.decisions.slice(written), sandbox, r, day))
    for (const c of r.checkpoints.get(day) ?? []) states.push(checkpoint(sandbox, r, c))
  }
  for (const [name, n] of upkeep.safeguards()) add(name, n)
  const roles = new Map([...sandbox.results].flatMap(([id, x]) => (x.role ? [[r.slugOf(id), x.role] as const] : [])))
  for (const ov of sandbox.overviews.values()) for (const e of activeEntries(ov)) roles.set(r.slugOf(e.storyId), entryRole(e))
  const founded = foundedOverviews(sandbox, r)
  const ended = founded.map(ov => ({
    id: ov.id,
    members: ov.members,
    foundedFrom: ov.foundedFrom,
    endEvent: ov.charter.endEvent,
    title: ov.title,
    foundedOn: ov.foundedOn,
  }))
  const traces = [...lastResults.values()].map(x => traceOf(x, sandbox.results.get(x.story.id)?.outcome ?? null, counts.get(x.story.id) ?? null, r.slugOf))
  return {
    result: {
      run,
      overviews: ended,
      roles,
      checkpoints: states,
      recenters,
      splits: splitsOf(r.keys, ended),
      safeguards,
      costUsd: r.ctx.spentUsd() - runStart,
      founded: founded.length,
    },
    // Diagnosed as the linking steps diagnose theirs, with the stories the upkeep detached again
    diagnostics: diagnoseRun({
      keys: r.keys,
      others: r.others,
      run,
      overviews: founded,
      traces: new Map(traces.map(t => [t.slug, t])),
      roles,
      replayed: r.replayedSlugs,
      neighbourLimit: config.overviews.neighbourLimit,
      detached: detachedOf(sandbox, r),
    }),
    ...(stopped ? { stopped } : {}),
  }
}

export async function runReplayStep(o: ReplayStepOptions): Promise<ReplayStepReport> {
  const { keys, others, asked, background } = linkReplayStories(o.files, o.half, o.groups)
  const left: ReplayStepReport['left'] = o.files
    .filter(f => !f.key || f.errors.length > 0)
    .map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))
  const report = { half: o.half, repeat: o.repeat, ...(o.limit !== undefined ? { limit: o.limit } : {}), keys: keys.map(k => k.id) }
  // The re-centers are scored against the keys' centers: none may be a draft no one checked
  const refused = awaitingReview(keys, 'centers')
  if (refused) {
    return {
      ...report,
      stories: 0,
      background: { keys: [], stories: 0 },
      left,
      runs: [],
      score: scoreReplay(keys, [], config.overviews.minStandsFacts, 0),
      diagnostics: [],
      costUsd: 0,
      stopped: refused,
    }
  }
  // The half's stories and the background together, in one date order, as the linking steps replay them
  const { replayed, slugOf: slugById, notPublished } = await loadReplayed(o.stories, asked, o.limit)
  for (const slug of notPublished) left.push({ what: slug, reason: 'not published in this database' })
  const byId = new Map(replayed.map(s => [s.id, s]))
  const slugOf = (id: string) => slugById.get(id) ?? id
  const replayedSlugs = new Set(replayed.map(s => slugOf(s.id)))
  const factsOf = new Map<string, MemberFact[]>()
  for (const f of await o.facts([...byId.keys()])) factsOf.set(f.storyId, [...(factsOf.get(f.storyId) ?? []), f])
  const checkpoints = new Map<string, Checkpoint[]>()
  for (const k of keys) for (const c of checkpointsOf(k)) checkpoints.set(c.day, [...(checkpoints.get(c.day) ?? []), { key: k, ...c }])
  const lastStoryDay = replayed
    .map(s => s.date)
    .sort()
    .at(-1)

  const spentBefore = o.ctx.spentUsd()
  let stopped: string | undefined
  const runs: ReplayRunResult[] = []
  const diagnostics: RunDiagnostics[] = []
  if (lastStoryDay) {
    const input: ReplayInput = {
      keys,
      others,
      index: linkKeys(keys, others),
      replayed,
      byId,
      slugOf,
      replayedSlugs,
      facts: storyIds => storyIds.flatMap(id => factsOf.get(id) ?? []),
      checkpoints,
      lastDay: lastReplayDay(lastStoryDay),
      neighbours: o.neighbours,
      ctx: o.ctx,
      // Production's look-ahead at most, as the linking steps' replay (`link.ts`): --concurrency caps throughput, not what a night is
      lookAhead: Math.min(o.concurrency, config.overviews.concurrency),
      budgetUsd: o.budgetUsd,
    }
    for (const run of runNumbers(o.repeat)) {
      const done = await replayOneRun(run, input)
      runs.push(done.result)
      diagnostics.push(done.diagnostics)
      if (done.stopped) {
        stopped = done.stopped
        break
      }
    }
  }
  return {
    ...report,
    stories: replayed.length,
    background: { keys: background.keys.map(k => k.id), stories: background.slugs.filter(s => replayedSlugs.has(s)).length },
    left,
    runs,
    score: scoreReplay(keys, runs, config.overviews.minStandsFacts, replayed.length, others),
    diagnostics,
    costUsd: o.ctx.spentUsd() - spentBefore,
    ...(stopped ? { stopped } : {}),
  }
}
