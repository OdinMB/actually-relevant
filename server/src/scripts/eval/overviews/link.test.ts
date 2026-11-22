import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { config } from '../../../config.js'
import { promptText, type Prompt } from '../../../lib/promptCache.js'
import type { FoundAnswer, FoundCheckAnswer, LinkAnswer } from '../../../schemas/overviews.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { OVERVIEW_STEPS } from '../../../services/overviewSteps.js'
import type { LinkStory } from '../../../services/overviewTypes.js'
import { BUDGET_EXHAUSTED, versionedSchemaName } from '../models.js'
import type { CallRecord } from '../types.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'
import { backgroundOf, END_EVENT_SCHEMA, rescoreLinkStep, runLinkStep } from './link.js'
import { linkLines } from './linkReport.js'
import { replayNotSaved, savedReplayName, writeSavedReplay } from './savedLinkReplay.js'

const DAYS = { a: 1, b: 2, c: 3, x: 2 } as const
const story = (slug: keyof typeof DAYS): LinkStory => ({
  id: `id-${slug}`,
  title: `Story ${slug.toUpperCase()}`,
  label: 'Ebola',
  summary: `Summary ${slug}`,
  datePublished: new Date(Date.UTC(2026, 4, DAYS[slug])),
  date: `2026-05-0${DAYS[slug]}`,
  issueId: null,
  facts: [],
})

const key: AnswerKey = {
  schemaVersion: 1,
  id: 'ebola-drc-2026',
  title: 'Ebola',
  charter: { in: 'In.', out: [], endEvent: null },
  figures: [],
  entries: (['a', 'b', 'c'] as const).map(slug => ({
    slug,
    date: story(slug).date,
    title: story(slug).title,
    join: 'must' as const,
    role: 'routine' as const,
    kind: null,
    values: [],
    statuses: [],
    why: 'w',
  })),
  nearMisses: [],
  responses: [],
  centers: [],
  notes: '',
}
const files: KeyFile[] = [{ file: 'ebola-drc-2026.json', key, errors: [] }]

/** Every link answer says no to every candidate; story C's call is not in the cache. */
function fakeCtx() {
  const names: string[] = []
  const call = async <T>(_a: unknown, schemaName: string, _schema: unknown, prompt: Prompt): Promise<CallRecord<T>> => {
    names.push(schemaName)
    const text = promptText(prompt)
    const refs = [...text.matchAll(/<(?:OVERVIEW|CANDIDATE) id="([OF]\d+)"/g)].map(m => m[1]!)
    const blank = { cause: { story: '', other: '' }, place: { story: '', other: '' }, end: { story: '', other: '' } }
    const answer: LinkAnswer = {
      candidates: refs.map(id => ({
        id,
        belongs: 'no',
        ...blank,
        reportsEndEvent: false,
        scope: 'unrelated',
        centerMoved: false,
        signalQuote: '',
        confidence: 0.2,
      })),
      role: 'routine',
      roleKind: null,
    }
    const skipped = text.includes('<TITLE>Story C</TITLE>')
    return {
      key: 'k',
      arm: 'a',
      schema: schemaName,
      outcome: skipped ? 'skipped' : 'ok',
      parsed: skipped ? null : (answer as T),
      content: '',
      finishReason: null,
      usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
      costUsd: 0,
      latencyMs: 0,
      at: '',
    }
  }
  return { names, ctx: { call, spentUsd: () => 0 } }
}

const near = (slug: keyof typeof DAYS): Neighbour => ({ id: `id-${slug}`, datePublished: story(slug).datePublished, distance: 0.2, via: 'near' })

describe('runLinkStep', () => {
  it("diagnoses each run's missed must entries, counts the calls not made, and asks the cache under the step's own schema names", async () => {
    const { names, ctx } = fakeCtx()
    const { report } = await runLinkStep({
      ctx,
      files,
      half: 'judge',
      stories: async slugs => new Map(slugs.map(s => [s, s in DAYS ? story(s as keyof typeof DAYS) : null])),
      // The database's neighbours: one outside the replay, which is dropped but counted as read
      neighbours: async s => (s.id === 'id-b' ? [near('a')] : s.id === 'id-c' ? [near('a'), near('b'), { ...near('a'), id: 'elsewhere' }] : []),
      repeat: 2,
      concurrency: 1,
      budgetUsd: 1,
    })
    expect(report.diagnostics.map(d => d.run)).toEqual([1, 2])
    const causes = new Map(report.diagnostics[0]!.missed.map(m => [m.slug, m]))
    expect(causes.get('a')).toMatchObject({ cause: 'no candidate' })
    expect(causes.get('b')).toMatchObject({ cause: 'model no', detail: 'F1 0.20: no 0.20, unrelated; ebola-drc-2026 was never founded' })
    expect(causes.get('c')).toMatchObject({ cause: 'failed', detail: 'the link call gave no answer' })
    expect(report.unanswered).toBe(2)
    const link = versionedSchemaName(OVERVIEW_STEPS.link.name, OVERVIEW_STEPS.link.schema)
    expect(new Set(names)).toEqual(new Set([link, `${link}~run2`]))
    expect(report.score.role[0]!.value).toBeNull()
  })

  it('replays, in a judged run, the background stories of the keys outside the half that share an entry with it, in date order, and in a tuning run none', async () => {
    const iran: AnswerKey = { ...key, id: 'iran-war-2026', entries: (['c', 'x'] as const).map(slug => ({ ...key.entries[0]!, slug, date: story(slug).date })) }
    const both: KeyFile[] = [...files, { file: 'iran-war-2026.json', key: iran, errors: [] }]
    const order: string[] = []
    const replay = async (half: 'judge' | 'tune') => {
      const { report } = await runLinkStep({
        ctx: fakeCtx().ctx,
        files: both,
        half,
        stories: async slugs => new Map(slugs.map(s => [s, s in DAYS ? story(s as keyof typeof DAYS) : null])),
        neighbours: async s => {
          order.push(s.id)
          return []
        },
        repeat: 1,
        concurrency: 1,
        budgetUsd: 1,
      })
      return report
    }
    const judged = await replay('judge')
    expect(judged).toMatchObject({ stories: 4, background: { keys: ['iran-war-2026'], stories: 1 } })
    expect(order).toEqual(['id-a', 'id-b', 'id-x', 'id-c'])
    expect(await replay('tune')).toMatchObject({ stories: 2, background: { keys: [], stories: 0 } })
  })
})

// Six stories of one development, a day apart: s1 to s5 its must entries, s6 a near miss
const SLUGS = ['s1', 's2', 's3', 's4', 's5', 's6']
const STORIES = new Map<string, LinkStory>(
  SLUGS.map((slug, i) => [
    slug,
    {
      id: `id-${slug}`,
      title: `Story ${slug}`,
      label: 'Ebola',
      summary: `Summary of ${slug}`,
      datePublished: new Date(Date.UTC(2026, 4, i + 1)),
      date: `2026-05-0${i + 1}`,
      issueId: null,
      facts: [],
    },
  ]),
)
const entryOf = (slug: string, date: string) => ({ ...key.entries[0]!, slug, date, title: `Story ${slug}` })
const outbreak = (over: Partial<AnswerKey> = {}): KeyFile[] => [
  {
    file: 'ebola-drc-2026.json',
    errors: [],
    key: {
      ...key,
      entries: SLUGS.slice(0, 5).map(slug => entryOf(slug, STORIES.get(slug)!.date)),
      nearMisses: [{ slug: 's6', date: STORIES.get('s6')!.date, title: 'Story s6', why: 'looks alike' }],
      ...over,
    },
  },
]

const quoted = { cause: { story: 'Ebola', other: 'Ebola' }, place: { story: 'Ebola', other: 'Ebola' }, end: { story: '', other: '' } }
const routine = { role: 'routine' as const, roleKind: null }
const FOUND: FoundAnswer = {
  title: 'Ebola outbreak',
  charter: { in: 'The Ebola outbreak in the east.', out: [], endEvent: 'The outbreak is declared over' },
  roles: { a: routine, b: routine },
}
const CHECK: FoundCheckAnswer = { a: { fits: 'yes', reason: 'r' }, b: { fits: 'yes', reason: 'r' }, endEventConcrete: 'yes' }
const isStep = (schemaName: string, name: string) => schemaName.startsWith(`${name}#`)

/** A fixed model, a function of the step and the prompt alone: yes to every candidate, every founding agreed, the end events the same. */
function answerOf(schemaName: string, text: string): unknown {
  if (isStep(schemaName, OVERVIEW_STEPS.link.name)) {
    const refs = [...text.matchAll(/<(?:OVERVIEW|CANDIDATE) id="([OF]\d+)"/g)].map(m => m[1]!)
    const answer: LinkAnswer = {
      candidates: refs.map(id => ({
        id,
        belongs: 'yes',
        ...quoted,
        reportsEndEvent: false,
        scope: 'inside',
        centerMoved: false,
        signalQuote: '',
        confidence: 0.9,
      })),
      ...routine,
    }
    return answer
  }
  if (isStep(schemaName, OVERVIEW_STEPS.found.name)) return FOUND
  if (isStep(schemaName, OVERVIEW_STEPS.foundCheck.name)) return CHECK
  return { same: 'yes', why: 'Both end when the outbreak is declared over.' }
}

const recordOf = <T>(schemaName: string, parsed: T | null, costUsd: number): CallRecord<T> => ({
  key: schemaName,
  arm: 'a',
  schema: schemaName,
  outcome: parsed === null ? 'skipped' : 'ok',
  parsed,
  content: '',
  finishReason: null,
  usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
  costUsd,
  latencyMs: 0,
  at: '',
})

/**
 * The fixed model behind a recording cache: each call answers after its run's delay, and is kept by
 * its schema name and prompt. Counts each run's link calls in flight, and orders every call's start
 * and end on one counter.
 */
function fixedModel(delayOf: (run: number) => number = () => 1) {
  const recorded = new Map<string, CallRecord>()
  /** The replay's calls (link, found, found check), the end-event judge's left out. */
  const calls: { run: number; start: number; end: number }[] = []
  const inFlight = new Map<number, number>()
  const mostInFlight = new Map<number, number>()
  let tick = 0
  const call = async <T>(_a: unknown, schemaName: string, _schema: unknown, prompt: Prompt): Promise<CallRecord<T>> => {
    const run = Number(/~run(\d+)$/.exec(schemaName)?.[1] ?? 1)
    const link = isStep(schemaName, OVERVIEW_STEPS.link.name)
    const start = tick++
    if (link) {
      inFlight.set(run, (inFlight.get(run) ?? 0) + 1)
      mostInFlight.set(run, Math.max(mostInFlight.get(run) ?? 0, inFlight.get(run)!))
    }
    await new Promise(resolve => setTimeout(resolve, delayOf(run)))
    if (link) inFlight.set(run, inFlight.get(run)! - 1)
    if (!isStep(schemaName, END_EVENT_SCHEMA.split('#')[0]!)) calls.push({ run, start, end: tick++ })
    const rec = recordOf(schemaName, answerOf(schemaName, promptText(prompt)) as T, 0.125)
    recorded.set(`${schemaName}\n${promptText(prompt)}`, rec)
    return rec
  }
  return { ctx: { call, spentUsd: () => 0 }, recorded, calls, mostInFlight }
}

/** A context that answers only what the fixed model recorded, as a cache-only context does; the schema names it was asked. */
function fromCache(recorded: ReadonlyMap<string, CallRecord>) {
  const asked: string[] = []
  const call = async <T>(_a: unknown, schemaName: string, _schema: unknown, prompt: Prompt): Promise<CallRecord<T>> => {
    asked.push(schemaName)
    const hit = recorded.get(`${schemaName}\n${promptText(prompt)}`)
    return (hit ?? { ...recordOf(schemaName, null, 0), error: 'not in the cache (--cache-only)' }) as CallRecord<T>
  }
  return { ctx: { call }, asked }
}

const replayOf = (files: KeyFile[], ctx: Parameters<typeof runLinkStep>[0]['ctx'], over: Partial<Parameters<typeof runLinkStep>[0]> = {}) =>
  runLinkStep({
    ctx,
    files,
    half: 'judge',
    stories: async slugs => new Map(slugs.map(s => [s, STORIES.get(s) ?? null])),
    // Every earlier story, newest first
    neighbours: async s =>
      [...STORIES.values()]
        .filter(x => x.datePublished < s.datePublished)
        .reverse()
        .map(x => ({ id: x.id, datePublished: x.datePublished, distance: 0.2, via: 'near' as const })),
    repeat: 2,
    concurrency: 8,
    budgetUsd: 1,
    ...over,
  })

describe('runLinkStep, its repeats side by side', () => {
  it("replays the runs at once, each at production's look-ahead, and reports them in run order as one run after the other would", async () => {
    const slowFirst = fixedModel(run => (run === 1 ? 15 : 1))
    const { report } = await replayOf(outbreak(), slowFirst.ctx)
    // Run 2's calls began before run 1's had ended
    const lastOfRun1 = Math.max(...slowFirst.calls.filter(c => c.run === 1).map(c => c.end))
    const firstOfRun2 = Math.min(...slowFirst.calls.filter(c => c.run === 2).map(c => c.start))
    expect(firstOfRun2).toBeLessThan(lastOfRun1)
    expect(Math.max(...slowFirst.mostInFlight.values())).toBeLessThanOrEqual(config.overviews.concurrency)

    expect(report.score.runs.map(r => r.run)).toEqual([1, 2])
    expect(report.diagnostics.map(d => d.run)).toEqual([1, 2])
    expect(report.signals.map(s => s.run)).toEqual([1, 2])
    expect(report.endEvents.map(e => e.run)).toEqual([1, 2])
    // A fixed model answers both runs alike, so each run is the replay a serial run gives
    expect(report.score.runs[0]!.foundings).toBe(1)
    expect(report.score.runs[1]).toEqual({ ...report.score.runs[0], run: 2 })
    expect(report.diagnostics[1]).toEqual({ ...report.diagnostics[0], run: 2 })
    expect(report.endEvents[1]).toEqual({ ...report.endEvents[0], run: 2 })
    // Whichever run finishes first
    const slowSecond = fixedModel(run => (run === 2 ? 15 : 1))
    expect((await replayOf(outbreak(), slowSecond.ctx)).report).toEqual(report)
  })

  it('stops every run once the budget refuses a call, though the spend recorded is still below it', async () => {
    const refusing = {
      call: async <T>(_a: unknown, schemaName: string): Promise<CallRecord<T>> => ({ ...recordOf<T>(schemaName, null, 0), error: BUDGET_EXHAUSTED }),
      spentUsd: () => 0,
    }
    const { report } = await replayOf(outbreak(), refusing)
    expect(report.stopped).toMatch(/runs 1, 2/)
    for (const d of report.diagnostics) expect(d.missed.filter(m => m.cause === 'not linked').map(m => m.slug)).toContain('s5')
  })

  it("rebuilds from the cache, in a folder whose recorded spend has reached the budget, the paid run's replay, since a cache-only rerun spends nothing", async () => {
    const model = fixedModel()
    const paid = await replayOf(outbreak(), model.ctx, { concurrency: 1 })
    // The folder's ledger now holds the paid run and more: past --budget
    const overBudget = { ...fromCache(model.recorded).ctx, spentUsd: () => 5 }
    const rebuilt = await replayOf(outbreak(), overBudget, { concurrency: 1, cacheOnly: true })
    expect(rebuilt.replay!.runs.map(r => r.stopped)).toEqual([false, false])
    expect(replayNotSaved(rebuilt.replay!, { cacheOnly: true })).toBeNull()
    expect(rebuilt.report).toEqual(paid.report)
    // A run that may spend is still stopped there
    expect((await replayOf(outbreak(), overBudget, { concurrency: 1 })).report.stopped).toMatch(/runs 1, 2/)
  })
})

describe('rescoreLinkStep', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  /** A paid replay of the outbreak's key, its saved replay written to a temp folder, and the fixed model's records. */
  const paidRun = async () => {
    const model = fixedModel()
    const paid = await replayOf(outbreak(), model.ctx)
    const dir = mkdtempSync(join(tmpdir(), 'link-rescore-'))
    dirs.push(dir)
    const file = join(dir, savedReplayName({ half: 'judge', repeat: 2 }))
    writeSavedReplay(file, paid.replay!)
    return { paid, file, recorded: model.recorded }
  }
  const rescore = (files: KeyFile[], file: string, recorded: ReadonlyMap<string, CallRecord>) => {
    const cache = fromCache(recorded)
    return { asked: cache.asked, report: rescoreLinkStep({ ctx: cache.ctx, files, half: 'judge', repeat: 2, file }) }
  }

  it("gives, under unchanged keys, the paid run's report, asking only the end-event judge and only the cache", async () => {
    const { paid, file, recorded } = await paidRun()
    const { asked, report } = rescore(outbreak(), file, recorded)
    const { rescored, ...again } = await report
    expect(again).toEqual(paid.report)
    expect(rescored).toMatchObject({ added: [], removed: [] })
    expect(new Set(asked.map(n => n.replace(/~run\d+$/, '')))).toEqual(new Set([END_EVENT_SCHEMA]))
    expect(linkLines({ ...again, rescored: rescored! }, ['link']).join('\n')).not.toMatch(/not evidence/)
  })

  it('lists a must entry the keys name since the run as not replayed, under Left out, and marks the rescore as no evidence for the gate', async () => {
    const { file, recorded } = await paidRun()
    const keys = outbreak({ entries: [...outbreak()[0]!.key!.entries, entryOf('late', '2026-05-09')] })
    const report = await rescore(keys, file, recorded).report
    expect(report.rescored).toMatchObject({ added: ['late'], removed: [] })
    const left = report.left.find(l => l.what === 'late')
    expect(left?.reason).toMatch(/saved replay/)
    for (const d of report.diagnostics) expect(d.missed.find(m => m.slug === 'late')).toMatchObject({ cause: 'not replayed', detail: left!.reason })
    expect(linkLines(report, ['link']).join('\n')).toMatch(/not evidence for the gate/)
  })

  it("leaves the end events unjudged when the key's end event changed since the run, so that bar has no verdict", async () => {
    const { file, recorded } = await paidRun()
    const keys = outbreak({ charter: { ...key.charter, endEvent: 'A vaccine is approved' } })
    const report = await rescore(keys, file, recorded).report
    expect(report.endEvents.map(e => e.verdict)).toEqual(['unjudged', 'unjudged'])
    expect(report.endEvents[0]!.why).toMatch(/^not judged/)
    expect(report.score.found[1]!.value).toBeNull()
  })
})

describe('backgroundOf', () => {
  const withSlugs = (id: string, entries: string[], nearMisses: string[] = []): AnswerKey => ({
    ...key,
    id,
    entries: entries.map(slug => ({ ...key.entries[0]!, slug })),
    nearMisses: nearMisses.map(slug => ({ slug, date: '2026-05-01', title: slug, why: 'looks alike' })),
  })
  const judged = withSlugs('judged', ['a', 'b'], ['n'])

  it('takes the entries, never the near misses, of each outside key whose own entry the replay holds, each slug once and none already replayed', () => {
    const sharesItsEntry = withSlugs('war', ['n', 'w1', 'w2'], ['w3'])
    const sharesANearMiss = withSlugs('lookalike', ['l1'], ['a'])
    const overlaps = withSlugs('strait', ['a', 'w1', 's1'])
    const label = withSlugs('label', ['a', 'b'])
    const bg = backgroundOf([judged], [sharesItsEntry, sharesANearMiss, overlaps, label])
    expect(bg.slugs).toEqual(['w1', 'w2', 's1'])
    expect(bg.keys.map(k => k.id)).toEqual(['war', 'strait'])
  })
})
