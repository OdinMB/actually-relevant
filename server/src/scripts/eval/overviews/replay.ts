/**
 * The `closure` and `replay` steps (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"):
 * one replay of the whole module per development serves both. The half's stories (entries and near
 * misses) are linked day by day in date order as the `link` step links them, and after each day
 * production's upkeep runs (`runUpkeep`) over the sandbox (`upkeepSandbox.ts`) with the day as its
 * clock: the closing checks, the status machine, reviews and the stands, on the eval's cached calls
 * at the step tiers. The days run on past the last story until every closing has had time to finish.
 * Each development is looked at on its checkpoint days; `replayScore.ts` scores the bars. The members'
 * facts are given by the runner: the `pass-pool` step's pools, or the database's. Each run k ≥ 2 has
 * its own cache keys. It refuses, before any read or call, while a key of its half holds a drafted
 * end no one has reviewed (`awaitingReview`).
 */
import { config } from '../../../config.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { linkInOrder, type LinkDeps } from '../../../services/overviewLink.js'
import { standsFacts, type MemberFact } from '../../../services/overviewStands.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { runUpkeep } from '../../../services/overviewUpkeep.js'
import { runNumbers } from '../repeats.js'
import type { SuiteContext } from '../types.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, type AnswerKey } from './keySchema.js'
import { evalCalls, replaySlugs } from './link.js'
import { developmentOf, keyIndex } from './linkScore.js'
import { activeEntries, createSandbox, roleOf, type Sandbox } from './overviewSandbox.js'
import { checkpointsOf, scoreReplay, type CheckpointState, type Closure, type ReplayRunResult, type ReplayScore } from './replayScore.js'
import { sandboxUpkeep } from './upkeepSandbox.js'

/** Days the replay runs on past the last story and the last end: a closing's days, then time for its review and the 14-day bar. */
export const TAIL_DAYS = config.overviews.closingDays + 14

export interface ReplayStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  neighbours(story: LinkStory): Promise<Neighbour[]>
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
  // The closures are scored against the keys' ends: none may be a draft no one checked
  const refused = awaitingReview(keys, 'closed')
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
  const byDay = new Map<string, LinkStory[]>()
  for (const s of replayed) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s])
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
    const upkeep = sandboxUpkeep(sandbox, facts, () => clock)
    const { link: linkCalls, ...calls } = evalCalls(o.ctx, run)
    const safeguards: Record<string, number> = {}
    const add = (name: string, n: number) => {
      if (n > 0) safeguards[name] = (safeguards[name] ?? 0) + n
    }
    const deps: LinkDeps = {
      neighbours: async s => (await o.neighbours(s)).filter(n => ids.has(n.id)),
      memberships: sandbox.memberships,
      overviews: sandbox.candidateOverviews,
      stories: async wanted => wanted.flatMap(id => (byId.has(id) ? [byId.get(id)!] : [])),
      ...linkCalls,
    }
    const keepGoing = async () => {
      if (o.ctx.spentUsd() < o.budgetUsd) return true
      stopped ??= `the budget ran out in run ${run}: the days after it were not replayed`
      return false
    }
    const states: CheckpointState[] = []
    const closures: Closure[] = []
    const end = nextDay(new Date(Date.parse(`${lastDay}T00:00:00Z`) + TAIL_DAYS * DAY_MS).toISOString().slice(0, 10))
    for (let day = replayed[0]!.date; day < end && !stopped; day = nextDay(day)) {
      clock = new Date(`${day}T23:59:59Z`)
      sandbox.setClock(clock)
      const todays = byDay.get(day) ?? []
      if (todays.length > 0) {
        const linked = await linkInOrder(todays, deps, sandbox.apply, { concurrency: o.concurrency, keepGoing })
        add(
          'link yeses refused by code',
          linked.results.reduce((s, r) => s + r.refusals.length, 0),
        )
        add('foundings not agreed', linked.results.filter(r => r.founding && r.founding.outcome !== 'founded').length)
      }
      const before = new Map([...sandbox.overviews.values()].map(ov => [ov.id, ov.status]))
      const tally = await runUpkeep({ ...upkeep, ...calls }, { clock, now: clock, today: day }, keepGoing)
      add('upkeep items failed', tally.failed)
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
    for (const ov of overviews) for (const e of activeEntries(ov)) roles.set(slugOf(e.storyId), roleOf(e))
    runs.push({
      run,
      overviews: overviews.map(ov => ({
        id: ov.id,
        members: activeEntries(ov).map(e => slugOf(e.storyId)),
        foundedFrom: [slugOf(ov.foundedFrom[0]), slugOf(ov.foundedFrom[1])],
        endEvent: ov.charter.endEvent,
      })),
      roles,
      checkpoints: states,
      closures,
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
