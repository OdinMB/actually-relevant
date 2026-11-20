/**
 * The `closure` and `replay` steps (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"):
 * one replay of the whole module per development serves both. Each day runs the job's night
 * (`runNight`) over the sandbox (`overviewSandbox.ts`, `upkeepSandbox.ts`) with the day as its clock:
 * the half's stories (entries and near misses) published by then and owed by production's rule
 * (`owedOf`, `owedSlices`: a held, failed or conflicting one linked again when it is due) are linked
 * in date order, then production's upkeep runs (`runUpkeep`): the closing checks, the status machine,
 * re-centers, reviews and the stands, on the eval's cached calls at the step tiers. The days run on past the last story until every closing has had time to finish.
 * Each development is looked at on its checkpoint days; `replayScore.ts` scores the bars. The keys'
 * centers' stories are replayed too, and the signal fires the automated re-center as in production:
 * each applied re-center is recorded with its day. The members'
 * facts are given by the runner: the `pass-pool` step's pools, or the database's. Each run k ≥ 2 has
 * its own cache keys. It refuses, before any read or call, while a key of its half holds a drafted
 * end or a center no one has reviewed (`awaitingReview`).
 */
import { config } from '../../../config.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import type { LinkDeps } from '../../../services/overviewLink.js'
import { runNight } from '../../../services/overviewNight.js'
import { owedSlices } from '../../../services/overviewOwed.js'
import { standsFacts, type MemberFact } from '../../../services/overviewStands.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { runNumbers } from '../repeats.js'
import type { SuiteContext } from '../types.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, type AnswerKey } from './keySchema.js'
import { evalCalls, replaySlugs } from './link.js'
import { developmentOf, keyIndex } from './linkScore.js'
import { entryRole } from '../../../services/overviewCases.js'
import { activeEntries, createSandbox, owedOf, type Sandbox } from './overviewSandbox.js'
import { readInputs, recenterInputs } from '../../../services/overviewDecisions.js'
import {
  checkpointsOf,
  scoreReplay,
  splitsOf,
  type CheckpointState,
  type Closure,
  type ReplayRecenter,
  type ReplayRunResult,
  type ReplayScore,
} from './replayScore.js'
import { sandboxUpkeep } from './upkeepSandbox.js'

/** Days the replay runs on past the last story and the last end: a closing's days, then time for its review and the 14-day bar. */
export const TAIL_DAYS = config.overviews.closingDays + 14

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
}

export interface ReplayStepReport {
  half: ReplayStepOptions['half']
  repeat: number
  limit?: number
  keys: string[]
  stories: number
  left: { what: string; reason: string }[]
  runs: ReplayRunResult[]
  score: ReplayScore
  costUsd: number
  stopped?: string
}

const DAY_MS = 86_400_000
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

/** Each key's development at a checkpoint: the overview most of its must entries published by then are active in. */
function checkpoint(
  sandbox: Sandbox,
  key: AnswerKey,
  index: ReturnType<typeof keyIndex>,
  slugOf: (id: string) => string,
  at: { at: CheckpointState['at']; day: string },
  offerable: (storyIds: string[]) => number,
): CheckpointState {
  const must = new Set(key.entries.filter(e => e.join === 'must' && e.date <= at.day).map(e => e.slug))
  const own = new Set(key.entries.map(e => e.slug))
  let best: { id: string; found: number } | null = null
  for (const o of sandbox.overviews.values()) {
    const found = activeEntries(o).filter(e => must.has(slugOf(e.storyId))).length
    if (found > 0 && (!best || found > best.found)) best = { id: o.id, found }
  }
  const o = best ? sandbox.overviews.get(best.id)! : null
  const members = o ? activeEntries(o) : []
  return {
    key: key.id,
    at: at.at,
    day: at.day,
    overview: o ? { id: o.id, status: o.status, scope: o.scope, frozen: o.frozen } : null,
    mustByThen: must.size,
    mustFound: best?.found ?? 0,
    wrongMembers:
      o &&
      developmentOf(
        members.map(e => slugOf(e.storyId)),
        index.entry,
      ) === key.id
        ? members.filter(e => !own.has(slugOf(e.storyId))).length
        : 0,
    offerable: offerable(members.map(e => e.storyId)),
    stands: o?.stands ? { sentences: o.stands.sentences.length, doing: o.stands.doing.length } : null,
  }
}

export async function runReplayStep(o: ReplayStepOptions): Promise<ReplayStepReport> {
  const keys = o.files.flatMap(f => (f.key && f.errors.length === 0 && inDevelopmentHalf(f.key.id, o.half) ? [f.key] : []))
  const left: ReplayStepReport['left'] = o.files
    .filter(f => !f.key || f.errors.length > 0)
    .map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))
  // The closures are scored against the keys' ends, and the re-centers against their centers: none may be a draft no one checked
  const refused = awaitingReview(keys, 'closed') ?? awaitingReview(keys, 'centers')
  if (refused) {
    const score = scoreReplay(keys, [], config.overviews.minStandsFacts, 0)
    return {
      half: o.half,
      repeat: o.repeat,
      ...(o.limit !== undefined ? { limit: o.limit } : {}),
      keys: keys.map(k => k.id),
      stories: 0,
      left,
      runs: [],
      score,
      costUsd: 0,
      stopped: refused,
    }
  }
  const loaded = await o.stories(replaySlugs(keys))
  const slugById = new Map<string, string>()
  const stories: LinkStory[] = []
  for (const [slug, story] of loaded) {
    if (!story) left.push({ what: slug, reason: 'not published in this database' })
    else {
      slugById.set(story.id, slug)
      stories.push(story)
    }
  }
  stories.sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime() || a.id.localeCompare(b.id))
  const replayed = o.limit !== undefined ? stories.slice(0, o.limit) : stories
  const ids = new Set(replayed.map(s => s.id))
  const byId = new Map(replayed.map(s => [s.id, s]))
  const slugOf = (id: string) => slugById.get(id) ?? id
  const factsOf = new Map<string, MemberFact[]>()
  for (const f of await o.facts([...ids])) factsOf.set(f.storyId, [...(factsOf.get(f.storyId) ?? []), f])
  const facts = (storyIds: string[]) => storyIds.flatMap(id => factsOf.get(id) ?? [])
  const index = keyIndex(keys)
  const lastDay = [...replayed.map(s => s.date), ...keys.flatMap(k => (k.closed ? [k.closed.date] : []))].sort().at(-1)
  const checkpoints = new Map<string, { key: AnswerKey; at: CheckpointState['at']; day: string }[]>()
  for (const k of keys) for (const c of checkpointsOf(k)) checkpoints.set(c.day, [...(checkpoints.get(c.day) ?? []), { key: k, ...c }])

  const spentBefore = o.ctx.spentUsd()
  let stopped: string | undefined
  const runs: ReplayRunResult[] = []
  for (const run of runNumbers(o.repeat)) {
    if (replayed.length === 0 || !lastDay) break
    const runStart = o.ctx.spentUsd()
    const sandbox = createSandbox()
    let clock = new Date(0)
    // A story's neighbours as of a day (the runner's reads), among the replayed stories: linking reads them as of the story's own date, a re-center as of the development clock, as production does
    const near = async (id: string, asOf: Date) => (byId.has(id) ? (await o.neighbours(id, asOf)).filter(n => ids.has(n.id)) : [])
    const upkeep = sandboxUpkeep(sandbox, facts, () => clock, near)
    const { link: linkCalls, ...calls } = evalCalls(o.ctx, run)
    const safeguards: Record<string, number> = {}
    const add = (name: string, n: number) => {
      if (n > 0) safeguards[name] = (safeguards[name] ?? 0) + n
    }
    const storiesOf = async (wanted: string[]) => wanted.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []))
    const deps: LinkDeps = {
      neighbours: s => near(s.id, s.datePublished),
      memberships: sandbox.memberships,
      overviews: sandbox.candidateOverviews,
      stories: storiesOf,
      ...linkCalls,
    }
    const keepGoing = async () => {
      if (o.ctx.spentUsd() < o.budgetUsd) return true
      stopped ??= `the budget ran out in run ${run}: the days after it were not replayed`
      return false
    }
    const states: CheckpointState[] = []
    const closures: Closure[] = []
    const recenters: ReplayRecenter[] = []
    const end = nextDay(new Date(Date.parse(`${lastDay}T00:00:00Z`) + TAIL_DAYS * DAY_MS).toISOString().slice(0, 10))
    for (let day = replayed[0]!.date; day < end && !stopped; day = nextDay(day)) {
      clock = new Date(`${day}T23:59:59Z`)
      sandbox.setClock(clock)
      const before = new Map([...sandbox.overviews.values()].map(ov => [ov.id, ov.status]))
      const written = sandbox.decisions.length
      // The job's night over the sandbox: the stories published by today and owed by production's rule (a held, failed or conflicting one again when it is due), then the upkeep
      const night = await runNight(
        {
          owed: async () =>
            owedSlices(
              owedOf(
                sandbox,
                replayed.filter(s => s.date <= day),
              ),
              clock,
            ),
          stories: storiesOf,
          link: deps,
          apply: sandbox.apply,
          upkeep: { ...upkeep, ...calls },
        },
        { now: clock, today: day },
        { concurrency: o.concurrency, keepGoing },
      )
      add(
        'link yeses refused by code',
        night.run.results.reduce((s, r) => s + r.refusals.length, 0),
      )
      add('foundings not agreed', night.run.results.filter(r => r.founding && r.founding.outcome !== 'founded').length)
      add('stories given up after their last try', night.givenUp.length)
      add('upkeep items failed', night.upkeep?.failed ?? 0)
      for (const d of sandbox.decisions.slice(written)) {
        const ov = d.kind === 'recenter' && d.outcome === 'recentered' && d.overviewId ? sandbox.overviews.get(d.overviewId) : undefined
        if (!ov) continue
        const development = developmentOf(
          activeEntries(ov).map(e => slugOf(e.storyId)),
          index.entry,
        )
        const joined = (readInputs(recenterInputs, d.inputs)?.joined ?? []).map(slugOf)
        recenters.push({
          overviewId: ov.id,
          day,
          development,
          title: ov.title,
          joined,
          nearMissesJoined: joined.filter(s => development !== null && (index.nearMiss.get(s) ?? []).includes(development)),
        })
      }
      for (const ov of sandbox.overviews.values())
        if (ov.status === 'closed' && before.get(ov.id) !== 'closed')
          closures.push({
            overviewId: ov.id,
            development: developmentOf(
              activeEntries(ov).map(e => slugOf(e.storyId)),
              index.entry,
            ),
            reason: ov.closedReason === 'end_event' ? 'end_event' : 'faded',
            day,
          })
      for (const c of checkpoints.get(day) ?? []) states.push(checkpoint(sandbox, c.key, index, slugOf, c, members => standsFacts(facts(members), day).length))
    }
    for (const [name, n] of upkeep.safeguards()) add(name, n)
    const overviews = [...sandbox.overviews.values()]
    const roles = new Map([...sandbox.results].flatMap(([id, r]) => (r.role ? [[slugOf(id), r.role] as const] : [])))
    for (const ov of overviews) for (const e of activeEntries(ov)) roles.set(slugOf(e.storyId), entryRole(e))
    const ended = overviews.map(ov => ({
      id: ov.id,
      members: activeEntries(ov).map(e => slugOf(e.storyId)),
      foundedFrom: [slugOf(ov.foundedFrom[0]), slugOf(ov.foundedFrom[1])] as [string, string],
      endEvent: ov.charter.endEvent,
    }))
    runs.push({
      run,
      overviews: ended,
      roles,
      checkpoints: states,
      closures,
      recenters,
      splits: splitsOf(keys, ended),
      safeguards,
      costUsd: o.ctx.spentUsd() - runStart,
      founded: overviews.length,
    })
    if (stopped) break
  }
  return {
    half: o.half,
    repeat: o.repeat,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    keys: keys.map(k => k.id),
    stories: replayed.length,
    left,
    runs,
    score: scoreReplay(keys, runs, config.overviews.minStandsFacts, replayed.length),
    costUsd: o.ctx.spentUsd() - spentBefore,
    ...(stopped ? { stopped } : {}),
  }
}
