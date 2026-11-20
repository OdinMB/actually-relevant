/**
 * The `stands` step (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): production's
 * "Where this stands" (`standsFacts`, `refreshStands`) written at each development's checkpoints of the
 * half, from the facts of its must entries published by then and judged current on that day, on the
 * eval's cached calls at the step tiers; then the strong judge on every line kept, and
 * `standsScore.ts` on the bars. Each checkpoint reads the key's center in force that day (`centerOn`):
 * its title, its members (the base must entries and those of the centers by then, `mustEntriesOn`)
 * and its responses. A checkpoint with fewer than `minStandsFacts` offerable facts is
 * counted, never written. The development's own entries stand in for its overview, so the stands are
 * measured apart from linking (the `replay` step measures them together). The facts are the runner's:
 * the `pass-pool` step's pools, or the database's. Each run k ≥ 2 has its own cache keys; days start
 * only while the budget lasts. It refuses, before any read or call, while a key of its half holds a
 * drafted response or a center no one has reviewed (`awaitingReview`).
 */
import { config } from '../../../config.js'
import { refreshStands, standsFacts, type MemberFact, type OfferedFact } from '../../../services/overviewStands.js'
import { ROLE_KINDS, type LinkStory, type Role } from '../../../services/overviewTypes.js'
import { renderFact, type ContextFactData } from '../../../services/storyContextChecks.js'
import { versionedSchemaName } from '../models.js'
import { runNumbers } from '../repeats.js'
import type { SuiteContext } from '../types.js'
import { JUDGE_ARM } from './contextJudge.js'
import { inDevelopmentHalf } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { awaitingReview, centerOn, mustEntriesOn, type AnswerKey } from './keySchema.js'
import type { ContextFacts } from './contextFacts.js'
import type { FactFixture } from './factFixtures.js'
import { evalCall } from './link.js'
import { buildStandsJudgePrompt, standsJudgeSchema } from './prompts.js'
import { checkpointsOf } from './replayScore.js'
import { latestValues, scoreStands, statesValue, type StandsCheckpointRun, type StandsScore } from './standsScore.js'
import { upkeepCalls } from './upkeepCalls.js'

const JUDGE_NAME = versionedSchemaName('overview-stands-judge', standsJudgeSchema)

export interface StandsStepOptions {
  ctx: SuiteContext & { spentUsd(): number }
  files: KeyFile[]
  half: 'tune' | 'judge' | 'all'
  stories(slugs: string[]): Promise<Map<string, LinkStory | null>>
  facts(storyIds: string[]): Promise<MemberFact[]>
  repeat: number
  budgetUsd: number
  /** Only the first N developments (a smoke run). */
  limit?: number
}

/** A line run 1 kept, with the facts it cites: what `--facts stands` plants errors in. */
export interface KeptLine {
  key: string
  day: string
  text: string
  facts: ContextFactData[]
}

export interface StandsStepReport {
  half: StandsStepOptions['half']
  repeat: number
  keys: string[]
  runs: StandsCheckpointRun[]
  kept: KeptLine[]
  score: StandsScore
  costUsd: number
  stopped?: string
}

/**
 * `--facts stands`: the lines run 1 kept as the fact check's sample, at most `size`, each with its
 * cited facts' source sentences as its evidence (the sentences a stands line is checked against), so
 * the planted-error kinds are planted in stands lines.
 */
export function standsFactFixtures(kept: readonly KeptLine[], size: number): ContextFacts {
  const facts = kept.slice(0, size).map((l, i): FactFixture => {
    const [first] = l.facts
    return {
      key: `stands:${l.key}:${l.day}:${i + 1}`,
      runId: `stands:${l.key}`,
      storyId: null,
      sourceId: first?.source.id ?? 'S1',
      outlet: first?.source.outlet ?? '',
      url: first?.source.url ?? '',
      language: null,
      date: first?.source.date ?? null,
      statement: l.text,
      measures: l.facts
        .map(f => f.counted)
        .filter(Boolean)
        .join('; '),
      sentence: l.facts.map(f => f.passage ?? f.supportingSentence).join(' '),
    }
  })
  return {
    stories: new Set(kept.slice(0, size).map(l => l.key)).size,
    size,
    facts,
    shortfalls: facts.length < size ? [`${facts.length} of ${size} lines: the stands step kept no more`] : [],
  }
}

/** Whether an offered fact holds a value: its structured value, or its rendering stating it. */
const holds = (o: OfferedFact, value: number) => o.fact.value === value || statesValue(renderFact(o.fact), value)

export async function runStandsStep(o: StandsStepOptions): Promise<StandsStepReport> {
  const all = o.files.flatMap(f => (f.key && f.errors.length === 0 && inDevelopmentHalf(f.key.id, o.half) ? [f.key] : []))
  const keys = o.limit !== undefined ? all.slice(0, o.limit) : all
  // "What's being done" is scored against the keys' responses, and a center's members and responses: none may be a draft no one checked
  const refused = awaitingReview(keys, 'responses') ?? awaitingReview(keys, 'centers')
  if (refused) return { half: o.half, repeat: o.repeat, keys: keys.map(k => k.id), runs: [], kept: [], score: scoreStands([]), costUsd: 0, stopped: refused }
  const slugs = keys.flatMap(k => [...k.entries, ...k.centers.flatMap(c => c.entries)].filter(e => e.join === 'must').map(e => e.slug))
  const stories = await o.stories(slugs)
  const ids = [...stories.values()].flatMap(s => (s ? [s.id] : []))
  const factsOf = new Map<string, MemberFact[]>()
  for (const f of await o.facts(ids)) factsOf.set(f.storyId, [...(factsOf.get(f.storyId) ?? []), f])
  const spentBefore = o.ctx.spentUsd()
  const runs: StandsCheckpointRun[] = []
  const kept: KeptLine[] = []
  let stopped: string | undefined

  for (const run of runNumbers(o.repeat)) {
    const calls = upkeepCalls(o.ctx, run)
    for (const key of keys) {
      for (const point of checkpointsOf(key)) {
        if (o.ctx.spentUsd() >= o.budgetUsd) {
          stopped ??= `the budget ran out in run ${run}: the checkpoints after it were not written`
          break
        }
        const start = o.ctx.spentUsd()
        // Under the center in force that day: its title, its members and its responses
        const members = mustEntriesOn(key, point.day).flatMap(e => {
          const s = stories.get(e.slug)
          return s ? [{ slug: e.slug, story: s, role: keyRole(e) }] : []
        })
        const inForce = {
          title: centerOn(key, point.day)?.title ?? key.title,
          responses: [...key.responses, ...key.centers.filter(c => c.from <= point.day).flatMap(c => c.responses)],
        }
        const offered = standsFacts(
          members.flatMap(m => factsOf.get(m.story.id) ?? []),
          point.day,
        )
        const enough = offered.length >= config.overviews.minStandsFacts
        const record: StandsCheckpointRun = {
          key: key.id,
          ...point,
          run,
          offered: offered.length,
          enough,
          outcome: null,
          lines: [],
          latest: [],
          responseDue: false,
          doingPresent: false,
          costUsd: 0,
        }
        if (enough) await writeAndJudge(key, inForce, point.day, members, offered, record, calls.stands, o.ctx, run, kept)
        record.costUsd = o.ctx.spentUsd() - start
        runs.push(record)
      }
      if (stopped) break
    }
    if (stopped) break
  }
  return {
    half: o.half,
    repeat: o.repeat,
    keys: keys.map(k => k.id),
    runs,
    kept,
    score: scoreStands(runs),
    costUsd: o.ctx.spentUsd() - spentBefore,
    ...(stopped ? { stopped } : {}),
  }
}

/** A key entry's role as production's: a turning point's kind when it is one of production's, else none. */
export const keyRole = (e: AnswerKey['entries'][number]): Role => ({
  role: e.role,
  roleKind: e.role === 'routine' ? null : (ROLE_KINDS.find(k => k === e.kind) ?? null),
})

async function writeAndJudge(
  key: AnswerKey,
  inForce: { title: string; responses: AnswerKey['responses'] },
  day: string,
  members: { slug: string; story: LinkStory; role: Role }[],
  offered: OfferedFact[],
  record: StandsCheckpointRun,
  stands: ReturnType<typeof upkeepCalls>['stands'],
  ctx: SuiteContext,
  run: number,
  kept: KeptLine[],
): Promise<void> {
  const result = await refreshStands(
    { title: inForce.title, entries: members.map(m => ({ title: m.story.title, date: m.story.date, role: m.role })) },
    offered,
    day,
    stands,
  )
  record.outcome = result.outcome
  const byId = new Map(offered.map(f => [f.id, f]))
  const lines = [...result.sentences.map(l => ({ part: 'sentence' as const, ...l })), ...result.doing.map(l => ({ part: 'doing' as const, ...l }))]
  const judged =
    lines.length === 0
      ? null
      : await evalCall(
          ctx,
          JUDGE_ARM,
          JUDGE_NAME,
          standsJudgeSchema,
          buildStandsJudgePrompt({
            development: inForce.title,
            today: day,
            lines: lines.map((l, i) => ({
              id: `L${i + 1}`,
              text: l.text,
              facts: l.facts.flatMap(id =>
                byId.has(id)
                  ? [{ text: renderFact(byId.get(id)!.fact), date: byId.get(id)!.fact.asOf ?? byId.get(id)!.fact.source.date, current: byId.get(id)!.current }]
                  : [],
              ),
            })),
          }),
          run,
        )
  const verdicts = new Map((judged?.parsed?.lines ?? []).map(v => [v.id.trim(), v.supported === 'yes']))
  record.lines = lines.map((l, i) => ({ part: l.part, text: l.text, supported: verdicts.get(`L${i + 1}`) ?? null }))
  if (run === 1) for (const l of lines) kept.push({ key: key.id, day, text: l.text, facts: l.facts.flatMap(id => (byId.has(id) ? [byId.get(id)!.fact] : [])) })
  record.latest = latestValues(key, day)
    .filter(v => offered.some(f => holds(f, v.value)))
    .map(v => ({ ...v, stated: result.sentences.some(s => statesValue(s.text, v.value)) }))
  const idOf = new Map(members.map(m => [m.slug, m.story.id]))
  record.responseDue = inForce.responses.some(r => r.slug !== null && r.date <= day && offered.some(f => f.current && f.storyId === idOf.get(r.slug!)))
  record.doingPresent = result.doing.length > 0
}
