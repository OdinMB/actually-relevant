/**
 * The `recenter` step (`.context/model-eval.md`, "Overview evals"; plan
 * `.plans/2026-11-19_overview-recentering.md`, "Evals"): production's automated re-center
 * (`recenterOverview`: the draft, its blind check and the code rules) run directly on cases built from
 * the answer keys of the half, bypassing the signal that fires it in production. The cases:
 *
 * - each development's planted narrowed charter (`recenterPlants.ts`) at its two-thirds checkpoint,
 *   with the plant's members, offered the other must entries and the near misses of the 90 days
 *   before: a re-center to the key's charter expected, 3 runs;
 * - each reviewed center of a key, on the day its third entry on or after `from` is published, the
 *   charter in force before it and its members, offered the center's entries and near misses:
 *   re-centered expected, 3 runs (not run with fewer than 3 such entries);
 * - the anchor breach (Colorado offered only near misses of the wider Western water loss): no
 *   re-center expected, 3 runs;
 * - the neighbor a wider charter would absorb (Lebanon under an earlier charter, offered the regional
 *   war's near misses, with the Strait of Hormuz overview as its neighbor): no re-center expected, 3 runs;
 * - each development at its end checkpoint under its own charter (before any center), offered its near
 *   misses of the 90 days before: no re-center expected, 1 run (not run with fewer than
 *   `recenterMinJoins` of them).
 *
 * Offered stories are production's at most (`maxRecenterStories`, newest first), near misses at most
 * half of them while entries fill the rest, so a case offers both; each carries one signal quote
 * (`signalQuote`), as a story the link call flagged does. Only the neighbor case has a neighbor. The strong judge compares an applied expected re-center's
 * END_EVENT with the expected one. `recenterScore.ts` scores the bars. On the eval's cached calls at
 * the step's tier; each run k ≥ 2 has its own cache keys; attempts start only while the budget lasts.
 * It refuses, before any read or call, while a key of its half holds a center no one has reviewed.
 */
import { config } from '../../../config.js'
import { quoteFound } from '../../../lib/quoteMatch.js'
import { storyTexts } from '../../../services/overviewLink.js'
import {
  anchorOf,
  draftHoldsAnchor,
  recenterOverview,
  type AttemptOptions,
  type OfferedStory,
  type RecenterCase,
  type RecenterNeighbour,
} from '../../../services/overviewRecenter.js'
import type { ReviewEntry } from '../../../services/overviewReview.js'
import type { Charter, LinkStory, Role } from '../../../services/overviewTypes.js'
import type { SuiteContext } from '../types.js'
import { JUDGE_ARM } from './contextJudge.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, centerSlugs, mustEntriesOn, type AnswerKey } from './keySchema.js'
import { END_EVENT_SCHEMA, evalCall } from './link.js'
import type { EndEventVerdict } from './linkScore.js'
import { buildEndEventJudgePrompt, endEventJudgeSchema } from './prompts.js'
import { ANCHOR_BREACH, NARROWED_PLANTS, NEIGHBOUR_ABSORB } from './recenterPlants.js'
import { RECENTER_RUNS, expectsRecenter, scoreRecenters, type RecenterCaseKind, type RecenterCaseRun, type RecenterScore } from './recenterScore.js'
import { checkpointsOf } from './replayScore.js'
import { keyRole } from './stands.js'
import { upkeepCalls } from './upkeepCalls.js'

const DAY_MS = 86_400_000
const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10)
const NO_END = 'none (it ends by fading)'

type Loaded = ReadonlyMap<string, LinkStory | null>
type Entry = AnswerKey['entries'][number]

export interface RecenterStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  budgetUsd: number
  /** Only the first N cases (a smoke run). */
  limit?: number
}

/** A case as the step asks it, and what its attempts are scored against. */
export interface PlannedRecenter {
  id: string
  kind: RecenterCaseKind
  key: string
  day: string
  /** The development under the expected charter, for the judge. */
  development: string
  /** The END_EVENT a re-center is expected to name; null for none (it ends by fading). */
  expectedEndEvent: string | null
  /** Slugs of the case's near misses: none may join. */
  nearMisses: string[]
  members: number
  offered: number
  case: RecenterCase
  slugOf: Map<string, string>
}

export interface RecenterStepReport {
  half: RecenterStepOptions['half']
  limit?: number
  keys: string[]
  planned: { id: string; kind: RecenterCaseKind; day: string; members: number; offered: number; runs: number }[]
  notRun: { what: string; reason: string }[]
  runs: RecenterCaseRun[]
  score: RecenterScore
  costUsd: number
  stopped?: string
}

interface Member {
  slug: string
  story: LinkStory
  role: Role
}

/** A story a case offers, and the quote a plant gives its signal (`signalQuote`). */
interface Offered {
  slug: string
  story: LinkStory
  quote?: string
}

/**
 * The words an offered story's signal quotes, as production's link call gives them and its quote check
 * holds them (`storyTexts`): the plant's quote where the story's title, label or summary holds it,
 * otherwise the story's title, a run of its own words that points past the charter as the whole story does.
 */
export const signalQuote = (o: Offered): string => (o.quote && quoteFound(o.quote, storyTexts(o.story)) ? o.quote : o.story.title)

/**
 * The case production's `recenterOverview` reads, built as production's `recenterCases` would: an
 * ongoing open overview with these members (oldest first; the founding ones named), its anchor by
 * production's rule, the neighbors given (none but the neighbor case's), and the offered stories newest
 * first, each with one signal quote (`signalQuote`), as a story the link call flagged carries.
 */
export function buildCase(
  id: string,
  o: { title: string; charter: Charter; members: Member[]; founding: string[]; offered: Offered[]; neighbours?: RecenterNeighbour[] },
  options: AttemptOptions = config.overviews,
): { case: RecenterCase; slugOf: Map<string, string> } {
  const members = [...o.members].sort((a, b) => a.story.datePublished.getTime() - b.story.datePublished.getTime())
  const entryId = (slug: string) => `entry:${slug}`
  const entries: ReviewEntry[] = members.map(m => ({
    entryId: entryId(m.slug),
    storyId: m.story.id,
    title: m.story.title,
    label: m.story.label,
    summary: m.story.summary,
    date: m.story.date,
    role: m.role,
    locked: false,
  }))
  const anchor = anchorOf(
    members.map(m => ({ entryId: entryId(m.slug), status: 'active', published: true, datePublished: m.story.datePublished, role: m.role.role })),
    o.founding.map(entryId),
    options,
  )
  const stories: OfferedStory[] = [...o.offered]
    .sort((a, b) => b.story.datePublished.getTime() - a.story.datePublished.getTime() || a.slug.localeCompare(b.slug))
    .map(x => ({
      storyId: x.story.id,
      title: x.story.title,
      label: x.story.label,
      summary: x.story.summary,
      date: x.story.date,
      datePublished: x.story.datePublished,
      entryId: null,
      quotes: [signalQuote(x)],
    }))
  return {
    case: {
      overviewId: id,
      title: o.title,
      charter: o.charter,
      scope: 'ongoing',
      frozen: false,
      entries,
      closingStoryId: null,
      lockedOut: [],
      status: 'open',
      automatedRecenters: 0,
      anchor,
      stories,
      neighbours: o.neighbours ?? [],
      fired: { wider: 0, centerMoved: 0 },
    },
    slugOf: new Map([...members.map(m => [m.story.id, m.slug] as const), ...o.offered.map(s => [s.story.id, s.slug] as const)]),
  }
}

/**
 * The stories a case offers on `day`: those published in the `recenterLookbackDays` up to it, newest
 * first, at most `maxRecenterStories`; near misses take at most half of them while entries fill the rest.
 */
export function offeredOn(
  day: string,
  entries: readonly { slug: string; date: string }[],
  nearMisses: readonly { slug: string; date: string }[],
  options: Pick<AttemptOptions, 'recenterLookbackDays' | 'maxRecenterStories'> = config.overviews,
): string[] {
  const since = daysBefore(day, options.recenterLookbackDays)
  const inWindow = (xs: readonly { slug: string; date: string }[]) =>
    xs.filter(x => x.date >= since && x.date <= day).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
  const [misses, joins] = [inWindow(nearMisses), inWindow(entries)]
  const taken = joins.slice(0, options.maxRecenterStories - Math.min(Math.floor(options.maxRecenterStories / 2), misses.length))
  return [...misses.slice(0, options.maxRecenterStories - taken.length), ...taken].map(x => x.slug)
}

const published = (slugs: readonly string[], loaded: Loaded, quotes: Readonly<Record<string, string>> = {}): Offered[] =>
  slugs.flatMap(slug => (loaded.get(slug) ? [{ slug, story: loaded.get(slug)!, ...(quotes[slug] ? { quote: quotes[slug] } : {}) }] : []))
const membersOf = (entries: readonly Entry[], loaded: Loaded): Member[] =>
  entries.flatMap(e => (loaded.get(e.slug) ? [{ slug: e.slug, story: loaded.get(e.slug)!, role: keyRole(e) }] : []))

/** Every case of the half's keys, and those that cannot be built with why; `all`, the committed keys, give the neighbor case its neighbor. */
export function plannedCases(keys: readonly AnswerKey[], loaded: Loaded, all: readonly AnswerKey[] = keys, options: AttemptOptions = config.overviews) {
  const planned: PlannedRecenter[] = []
  const notRun: RecenterStepReport['notRun'] = []
  const add = (p: Omit<PlannedRecenter, 'case' | 'slugOf' | 'members' | 'offered'>, o: Parameters<typeof buildCase>[1]): void => {
    if (o.offered.length < options.recenterMinJoins) {
      notRun.push({ what: p.id, reason: `${o.offered.length} stories to offer on ${p.day}, fewer than the ${options.recenterMinJoins} a re-center takes in` })
      return
    }
    planned.push({ ...p, ...buildCase(p.id, o, options), members: o.members.length, offered: o.offered.length })
  }
  const byId = new Map(keys.map(k => [k.id, k]))
  const musts = (k: AnswerKey, day: string) => k.entries.filter(e => e.join === 'must' && e.date <= day)

  for (const plant of NARROWED_PLANTS) {
    const k = byId.get(plant.key)
    if (!k) continue
    const id = `planted ${k.id}`
    const day = checkpointsOf(k).find(c => c.at === 'two-thirds')?.day
    if (!day) {
      notRun.push({ what: id, reason: 'no two-thirds checkpoint' })
      continue
    }
    const listed = new Set(plant.members)
    const members = membersOf(
      k.entries.filter(e => listed.has(e.slug) && e.date <= day),
      loaded,
    ).sort((a, b) => plant.members.indexOf(a.slug) - plant.members.indexOf(b.slug))
    if (members.length < 2) {
      notRun.push({ what: id, reason: `${members.length} of the plant's members published here by ${day}` })
      continue
    }
    const others = musts(k, day).filter(e => !listed.has(e.slug))
    add(
      { id, kind: 'planted', key: k.id, day, development: k.title, expectedEndEvent: k.charter.endEvent, nearMisses: k.nearMisses.map(n => n.slug) },
      {
        title: plant.title,
        charter: { in: plant.in, out: [...k.charter.out], endEvent: plant.endEvent },
        members,
        founding: members.slice(0, 2).map(m => m.slug),
        offered: published(offeredOn(day, others, k.nearMisses, options), loaded),
      },
    )
  }

  for (const k of keys) {
    k.centers.forEach((c, i) => {
      const id = `center ${k.id} "${c.title}"`
      const after = c.entries.filter(e => e.date >= c.from).sort((a, b) => a.date.localeCompare(b.date))
      const third = after[2]
      if (!third) {
        notRun.push({ what: id, reason: `${after.length} center entries on or after ${c.from}, fewer than 3: too thin to build` })
        return
      }
      const day = third.date
      const before = k.centers[i - 1] ?? null
      const own = new Set(c.entries.map(e => e.slug))
      const members = membersOf(
        mustEntriesOn(k, day).filter(e => !own.has(e.slug)),
        loaded,
      )
      add(
        { id, kind: 'center', key: k.id, day, development: c.title, expectedEndEvent: c.charter.endEvent, nearMisses: c.nearMisses.map(n => n.slug) },
        {
          title: before?.title ?? k.title,
          charter: before?.charter ?? k.charter,
          members,
          // Its first two members found it, as the anchor keeps the development's start
          founding: members.slice(0, 2).map(m => m.slug),
          offered: published(
            offeredOn(
              day,
              c.entries.filter(e => e.join === 'must'),
              c.nearMisses,
              options,
            ),
            loaded,
          ),
        },
      )
    })
  }

  const breach = byId.get(ANCHOR_BREACH.key)
  if (breach) {
    const offered = published(ANCHOR_BREACH.offered, loaded, ANCHOR_BREACH.quotes)
    const day = offered
      .map(s => s.story.date)
      .sort()
      .at(-1)
    if (!day) notRun.push({ what: `breach ${breach.id}`, reason: 'none of its near misses is published here' })
    else {
      const members = membersOf(musts(breach, day), loaded)
      add(
        {
          id: `breach ${breach.id}`,
          kind: 'breach',
          key: breach.id,
          day,
          development: breach.title,
          expectedEndEvent: breach.charter.endEvent,
          nearMisses: [...ANCHOR_BREACH.offered],
        },
        { title: breach.title, charter: breach.charter, members, founding: members.slice(0, 2).map(m => m.slug), offered },
      )
    }
  }

  const absorbing = byId.get(NEIGHBOUR_ABSORB.key)
  if (absorbing) {
    const id = `neighbour ${absorbing.id}`
    const neighbour = all.find(k => k.id === NEIGHBOUR_ABSORB.neighbour)
    const offered = published(NEIGHBOUR_ABSORB.offered, loaded, NEIGHBOUR_ABSORB.quotes)
    const day = offered
      .map(s => s.story.date)
      .sort()
      .at(-1)
    if (!neighbour) notRun.push({ what: id, reason: `its neighbor's key ${NEIGHBOUR_ABSORB.neighbour} is not committed` })
    else if (!day) notRun.push({ what: id, reason: 'none of its offered stories is published here' })
    else {
      const notYet = new Set<string>(NEIGHBOUR_ABSORB.notYetOut)
      const members = membersOf(musts(absorbing, day), loaded)
      add(
        {
          id,
          kind: 'neighbour',
          key: absorbing.id,
          day,
          development: absorbing.title,
          expectedEndEvent: absorbing.charter.endEvent,
          nearMisses: [...NEIGHBOUR_ABSORB.offered],
        },
        {
          title: absorbing.title,
          charter: { ...absorbing.charter, out: absorbing.charter.out.filter(x => !notYet.has(x)) },
          members,
          founding: members.slice(0, 2).map(m => m.slug),
          offered,
          neighbours: [{ overviewId: `overview:${neighbour.id}`, title: neighbour.title, in: neighbour.charter.in }],
        },
      )
    }
  }

  for (const k of keys) {
    const end = checkpointsOf(k).find(c => c.at === 'end')?.day
    if (!end) continue
    // Under its own charter: before any center
    const first = k.centers[0]?.from
    const day = first && first <= end ? daysBefore(first, 1) : end
    const members = membersOf(musts(k, day), loaded)
    add(
      {
        id: `negative ${k.id}`,
        kind: 'negative',
        key: k.id,
        day,
        development: k.title,
        expectedEndEvent: k.charter.endEvent,
        nearMisses: k.nearMisses.map(n => n.slug),
      },
      {
        title: k.title,
        charter: k.charter,
        members,
        founding: members.slice(0, 2).map(m => m.slug),
        offered: published(offeredOn(day, [], k.nearMisses, options), loaded),
      },
    )
  }
  return { planned, notRun }
}

/** Every slug the half's cases may read: entries, near misses and the centers'. */
const caseSlugs = (keys: readonly AnswerKey[]) => [
  ...new Set(keys.flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug), ...centerSlugs(k)])),
]

export async function runRecenterStep(o: RecenterStepOptions): Promise<RecenterStepReport> {
  const all = o.files.flatMap(f => (f.key && f.errors.length === 0 ? [f.key] : []))
  const keys = all.filter(k => inDevelopmentHalf(k.id, o.half))
  const base = { half: o.half, ...(o.limit !== undefined ? { limit: o.limit } : {}), keys: keys.map(k => k.id) }
  // A center's case is scored against it: none may be a draft no one checked
  const refused = awaitingReview(keys, 'centers')
  if (refused) return { ...base, planned: [], notRun: [], runs: [], score: scoreRecenters([]), costUsd: 0, stopped: refused }
  const loaded = await o.stories(caseSlugs(keys))
  const built = plannedCases(keys, loaded, all)
  const cases = o.limit !== undefined ? built.planned.slice(0, o.limit) : built.planned
  const spentBefore = o.ctx.spentUsd()
  const runs: RecenterCaseRun[] = []
  let stopped: string | undefined
  const most = Math.max(0, ...cases.map(c => RECENTER_RUNS[c.kind]))
  for (let run = 1; run <= most && !stopped; run++) {
    const calls = upkeepCalls(o.ctx, run)
    for (const p of cases.filter(c => RECENTER_RUNS[c.kind] >= run)) {
      if (o.ctx.spentUsd() >= o.budgetUsd) {
        stopped = `the budget ran out in run ${run}: the cases after it were not asked`
        break
      }
      const start = o.ctx.spentUsd()
      const result = await recenterOverview(p.case, calls.recenter)
      const slug = (id: string) => p.slugOf.get(id) ?? id
      const joined = result.joins.map(j => slug(j.storyId))
      const applied = result.outcome === 'recentered'
      // What the model made of the anchor, before code held both calls to it: an applied re-center always holds it
      const draft = result.answer.draft
      const draftAnchorHeld = draft?.decision === 'recenter' ? draftHoldsAnchor(p.case, draft) : null
      let endEventVerdict: EndEventVerdict = null
      let why: string | null = null
      if (applied && expectsRecenter(p.kind)) {
        const named = result.charter?.endEvent ?? null
        if (named === null) endEventVerdict = 'none'
        else {
          const prompt = buildEndEventJudgePrompt({ development: p.development, key: p.expectedEndEvent ?? NO_END, founded: named })
          const answer = await evalCall(o.ctx, JUDGE_ARM, END_EVENT_SCHEMA, endEventJudgeSchema, prompt, run)
          endEventVerdict = answer.parsed ? (answer.parsed.same === 'yes' ? 'right' : 'wrong') : 'unjudged'
          why = answer.parsed?.why ?? 'the judge gave no answer'
        }
      }
      runs.push({
        case: p.id,
        kind: p.kind,
        key: p.key,
        day: p.day,
        run,
        outcome: result.outcome,
        rule: result.rule,
        refusals: result.refusals.map(r => r.rule),
        title: result.title,
        endEvent: result.charter?.endEvent ?? null,
        joined,
        nearMissesJoined: applied ? joined.filter(s => p.nearMisses.includes(s)) : [],
        detached: result.detaches.map(d => slug(d.storyId)),
        draftAnchorHeld,
        endEventVerdict,
        why,
        costUsd: o.ctx.spentUsd() - start,
      })
    }
  }
  return {
    ...base,
    planned: cases.map(c => ({ id: c.id, kind: c.kind, day: c.day, members: c.members, offered: c.offered, runs: RECENTER_RUNS[c.kind] })),
    notRun: built.notRun,
    runs,
    score: scoreRecenters(runs),
    costUsd: o.ctx.spentUsd() - spentBefore,
    ...(stopped ? { stopped } : {}),
  }
}
