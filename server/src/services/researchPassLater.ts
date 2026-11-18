/**
 * A later research pass's article step (`.context/research-passes.md`, "The later pass"; ADR-0068):
 * the judge of each section of the current version against the facts the pass found, the demotions
 * it names, the rewrite of the flagged sections alone (research's repair prompt in an update's
 * framing, merged by `withRepairs`, so every other section stays byte for byte), research's checks
 * and repair rounds on what the rewrite changed, the drops, the new version's projection with every
 * untouched section frozen as readers saw it, and the Update note, checked like a paragraph, with
 * its fixed-line fallback. The rules are `researchPassUpdate.ts`'s. No I/O of its own: the calls are
 * injected, so the `update` eval replays it on planted facts.
 */
import type { z } from 'zod'
import { config } from '../config.js'
import { buildFactCheckPrompt } from '../prompts/research.js'
import { buildJudgePrompt, buildNotePrompt, buildUpdateRewritePrompt, type NoteInput, type PassFactBrief } from '../prompts/researchPass.js'
import { factCheckSchema, repairSchema } from '../schemas/research.js'
import { judgeSchema, noteSchema, type JudgeAnswer } from '../schemas/researchPass.js'
import { renameCited, sourceRenames, versionArticle, withFrozen } from './articleVersions.js'
import {
  draftItems,
  dropFailing,
  evidenceFor,
  judgedProblems,
  numberHints,
  withoutInlineIds,
  type CitationProblem,
  type DraftItem,
  type PoolFact as CitableFact,
} from './researchChecks.js'
import { checkCopying, sourceLines } from './researchCopying.js'
import { buildResearchedStory, type CitedText, type ResearchedSource, type ResearchedStory } from './researchedStory.js'
import { citableFacts, recheck, repairDraft, type CheckContext, type CheckPass, type CheckState, type StepCaller, type StepResult } from './researchPipeline.js'
import { researchView, usable, type Article, type ArticleVersionData, type Pool, type PoolFact, type VersionChange } from './researchPool.js'
import {
  checkNote,
  demotions,
  fallbackNote,
  NOTE_LABEL,
  rewriteTargets,
  versionChanges,
  type Demotion,
  type Demotions,
  type RuleFact,
  type SectionJudgment,
} from './researchPassUpdate.js'
import { repairTargets, storyItems, withRepairs } from './researchRepair.js'

/** The later pass's own steps; its checks and repair rounds are research's (`fact-check`, `rewrite`, `derive`). */
export const LATER_STEPS = ['judge', 'update', 'note'] as const
export type LaterStep = (typeof LATER_STEPS)[number]

/** The tier each later step starts on; the `update` eval decides whether one moves (D6). */
export const LATER_STEP_TIERS: Record<LaterStep, 'small' | 'medium'> = { judge: 'medium', update: 'medium', note: 'medium' }

export type LaterCall = <T>(step: LaterStep, schema: z.ZodType<T>, prompt: string) => Promise<StepResult<T>>

export interface UpdateDeps {
  /** The metered call for the judge, the rewrite and the note, each recorded in the update's record. */
  call: LaterCall
  /** Research's recorded call for the checks and repair rounds of the rewritten sections and the note's fact check. */
  research: StepCaller
}

export interface UpdateInput {
  /** `YYYY-MM-DD`: the story's day, as the judge reads it. */
  storyDay: string
  /** The story's current version. */
  version: ArticleVersionData
  /** The pool after this pass's searches and fact check, before its demotions. */
  pool: Pick<Pool, 'sources' | 'facts'>
  /** The refs of the facts this pass added. */
  fresh: ReadonlySet<string>
}

/** `unchanged`: nothing to rewrite; `update_failed`: a section that cannot be dropped still failed, and the article stays as it is. */
export type UpdateOutcome = 'updated' | 'unchanged' | 'update_failed' | 'budget' | 'technical'

/** Everything the article step did, stored in the pass's record. */
export interface UpdateRecord {
  calls: (Omit<StepResult<unknown>, 'parsed'> & { step: LaterStep })[]
  /** Each section with the judge's verdict and what code made of it. */
  judgments: SectionJudgment[]
  demoted: Demotion[]
  superseded: Demotions['superseded']
  /** The checks of the rewritten sections, as research records a repair round's. */
  checks: CheckPass[]
  /** What the checks still found once the rounds were done (the dropped sections' among them). */
  problems: CitationProblem[]
  /** The section an `update_failed` failed on. */
  failedOn: string | null
  /**
   * The note served, whether it is the fixed line, what the checks found on the last note written,
   * and of the notes written, how many the fact check and copying checks ran on (`checked`), how
   * many of those a copying check flagged (`copied`: the eval's copying bar) and how many the fact
   * check found unsupported (`unsupported`: its "none unsupported" bar, a round repaired after
   * included). A record stored before `unsupported` reads it as absent.
   */
  note: { text: string; fallback: boolean; problems: string[]; checked: number; copied: number; unsupported?: number } | null
  /** Why the step failed, safe to store. */
  error: string | null
}

export interface UpdateResult {
  outcome: UpdateOutcome
  /** This pass's demotions, which the pool takes whatever the outcome. */
  demoted: Demotion[]
  /** The new version's article, projection, changes and note, when `updated`. */
  next: { article: Article; research: ResearchedStory; changes: VersionChange[]; note: CitedText } | null
  record: UpdateRecord
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** An earlier pass's demotion as a problem line: who it was contradicted by, or that an editor dropped it. */
const earlierReason = (f: PoolFact) =>
  f.drop?.reason === 'editor' ? 'an editor dropped it' : `contradicted by ${f.drop?.contradictedBy.join(', ') || 'newer reporting'}`

/** Runs the later pass's article step. Never throws: a failed call is a `technical` or `budget` outcome. */
export async function updateArticle(input: UpdateInput, deps: UpdateDeps): Promise<UpdateResult> {
  const record: UpdateRecord = { calls: [], judgments: [], demoted: [], superseded: [], checks: [], problems: [], failedOn: null, note: null, error: null }
  const done = (outcome: UpdateOutcome, next: UpdateResult['next'] = null): UpdateResult => ({ outcome, demoted: record.demoted, next, record })
  const call: LaterCall = async (step, schema, prompt) => {
    const res = await deps.call(step, schema, prompt)
    const { parsed: _parsed, ...rest } = res
    record.calls.push({ ...rest, step })
    return res
  }
  let skipped = false
  const research: StepCaller = async (step, schema, prompt) => {
    const res = await deps.research(step, schema, prompt)
    if (res.outcome === 'skipped') skipped = true
    return res
  }

  const article = versionArticle(input.version, input.pool)
  const sources = new Map(input.pool.sources.map(s => [s.ref, s]))
  const brief = (f: PoolFact): PassFactBrief => {
    const s = sources.get(f.sourceRef)
    return { id: f.ref, statement: f.statement, measures: f.measures, supportingSentence: f.supportingSentence, outlet: s?.outlet ?? '', date: s?.date ?? null }
  }
  const rule = (fs: PoolFact[]) => new Map<string, RuleFact>(fs.map(f => [f.ref, { measures: f.measures, asOf: f.structured?.asOf ?? null }]))
  const fresh = input.pool.facts.filter(f => input.fresh.has(f.ref) && usable(f) && sources.get(f.sourceRef)?.origin !== 'earlier')
  const old = input.pool.facts.filter(f => !input.fresh.has(f.ref) && usable(f))

  // The judge, when the pass found anything: nothing new can make a section wrong
  let judged: JudgeAnswer = { sections: [], contradicted: [] }
  if (fresh.length > 0) {
    const items = draftItems(article)
    const citedIds = new Set(items.flatMap(i => i.factIds))
    const res = await call(
      'judge',
      judgeSchema,
      buildJudgePrompt({
        storyDay: input.storyDay,
        sections: items.map(i => ({ label: i.label, text: i.text, factIds: i.cited ? i.factIds : null })),
        cited: input.pool.facts.filter(f => citedIds.has(f.ref)).map(brief),
        fresh: fresh.map(brief),
      }),
    )
    if (res.outcome === 'skipped') return done('budget')
    if (res.parsed === null) {
      record.error = `judge: ${res.outcome}`
      return done('technical')
    }
    judged = res.parsed
  }

  const d = demotions(judged.contradicted, { old: rule(old), fresh: rule(fresh) })
  record.demoted = d.demoted
  record.superseded = d.superseded
  const demotedNow = new Map(d.demoted.map(x => [x.ref, x]))
  const pool = { sources: input.pool.sources, facts: input.pool.facts.map(f => (demotedNow.has(f.ref) ? { ...f, status: 'demoted' as const } : f)) }
  const demoted = new Map(pool.facts.filter(f => f.status === 'demoted').map(f => [f.ref, demotedNow.get(f.ref)?.reason ?? earlierReason(f)]))
  const freshRefs = new Set(fresh.map(f => f.ref))
  const plan = rewriteTargets(article, judged.sections, { fresh: freshRefs, demoted })
  record.judgments = plan.judgments
  if (plan.targets.length === 0) return done('unchanged')

  // The rewrite of the targets alone, then research's checks and rounds on what it changed
  const writable = researchView(pool, usable)
  const ctx: CheckContext = { facts: citableFacts(writable.sources, writable.earlier), sources: researchView(pool).sources, call: research }
  const state: CheckState<Article> = { draft: article, checks: [], problems: plan.standing, rewritten: false }
  let repaired: Article
  try {
    const targets = repairTargets(article, plan.targets)
    const res = await call(
      'update',
      repairSchema,
      buildUpdateRewritePrompt({ sources: writable.sources, earlier: writable.earlier, story: storyItems(article), repairs: targets }),
    )
    if (res.outcome === 'skipped') return done('budget')
    if (res.parsed === null) {
      record.error = `update: ${res.outcome}`
      return done('technical')
    }
    state.rewritten = true
    const merged = withRepairs(article, withoutInlineIds(res.parsed), targets)
    let current = article
    if (merged.rewritten.length > 0) {
      if (!(await recheck(merged.draft, merged.rewritten, ctx, state))) return done('budget')
      current = merged.draft
    }
    repaired = await repairDraft(current, writable, ctx, state)
    if (skipped) return done('budget')
  } catch (err) {
    record.error = messageOf(err)
    return done(skipped ? 'budget' : 'technical')
  } finally {
    record.checks = state.checks
    record.problems = state.problems
  }

  // Sections still failing are dropped, unless the article cannot do without one: it then stays as it is
  const kept = dropFailing(repaired, state.problems)
  if ('failed' in kept) {
    record.failedOn = kept.failedOn
    record.error = kept.failed
    return done('update_failed')
  }
  const failing = new Set(state.problems.map(p => p.label))
  const dropped = new Set(
    draftItems(repaired)
      .filter(i => i.cited && failing.has(i.label))
      .map(i => i.label),
  )
  const final = kept.draft
  // The quote is never rewritten: it keeps the source readers saw it credited to
  const built = {
    ...buildResearchedStory({ draft: final, sources: writable.sources, earlier: writable.earlier }),
    quoteSourceId: input.version.research.quoteSourceId,
  }
  const { changes, frozen } = versionChanges({ article, research: input.version.research }, { article: final, research: built }, dropped)
  if (changes.length === 0) return done('unchanged')

  const written = await writeNote({ article: final, changes, plan: plan.judgments, fresh: freshRefs, demoted, demotedNow, pool, ctx, call, research }, record)
  // The note cites by the pool's ids, as the rebuilt sections do: both take the same new ids where the
  // version before gave one to another source, and the version lists the note's sources with its own
  const next = { ...built, sources: [...built.sources, ...written.sources.filter(s => !built.sources.some(b => b.id === s.id))] }
  const note = renameCited(written.note, sourceRenames(next, input.version.research))
  const projection = withFrozen(next, input.version.research, frozen, [note])
  return done('updated', { article: final, research: projection, changes, note })
}

/** The note with its citations, and the sources it cites besides the original (pool refs as ids). */
interface CitedNote {
  note: CitedText
  sources: ResearchedSource[]
}

interface NoteContext {
  article: Article
  changes: VersionChange[]
  plan: SectionJudgment[]
  fresh: ReadonlySet<string>
  demoted: ReadonlyMap<string, string>
  demotedNow: ReadonlyMap<string, Demotion>
  pool: Pick<Pool, 'sources' | 'facts'>
  ctx: CheckContext
  call: LaterCall
  research: StepCaller
}

/**
 * The Update note: what changed and why, from the changes and the facts they rest on (those the
 * changed sections cite now, and the demoted facts they cited), checked in code (`checkNote`), by
 * research's fact check and by both copying checks, with one repair round; a note that still fails,
 * or that the budget or a failed call leaves unwritten, is the fixed line (`fallbackNote`).
 */
async function writeNote(n: NoteContext, record: UpdateRecord): Promise<CitedNote> {
  const items = new Map(draftItems(n.article).map(i => [i.label, i]))
  const after = n.changes.filter(c => c.after !== null).flatMap(c => items.get(c.section)?.factIds ?? [])
  const founding = n.plan.flatMap(j => j.founding)
  const offered = [...new Set([...after, ...founding.filter(ref => n.demoted.has(ref))])]
  const byRef = new Map(n.pool.facts.map(f => [f.ref, f]))
  const sources = new Map(n.pool.sources.map(s => [s.ref, s]))
  const facts: NoteInput['facts'] = offered.flatMap(ref => {
    const f = byRef.get(ref)
    const s = f && sources.get(f.sourceRef)
    if (!f || !s) return []
    return [
      {
        id: ref,
        statement: f.statement,
        measures: f.measures,
        supportingSentence: f.supportingSentence,
        outlet: s.outlet,
        date: s.date,
        contradicted: n.demoted.has(ref),
      },
    ]
  })
  // The note may cite the demoted facts it is offered, so its checks read them beside the usable ones
  const view = researchView(n.pool, f => usable(f) || n.demoted.has(f.ref))
  const checkFacts = citableFacts(view.sources, view.earlier)
  const known = new Set(facts.map(f => f.id))
  const changes = n.changes.map(c => ({ label: c.section, before: c.before?.text ?? '', after: c.after?.text ?? null }))
  const cite = (text: string, factIds: string[]): CitedNote => {
    const built = buildResearchedStory({ draft: { story: [], whyThisMatters: [{ text, factIds }], caveats: [], quoteSourceId: '' }, ...view })
    return { note: built.whyThisMatters[0]!, sources: built.sources.filter(s => s.origin !== 'original') }
  }

  let previous: NoteInput['problems']
  const counts = { checked: 0, copied: 0, unsupported: 0 }
  for (let round = 0; round < 2; round++) {
    const res = await n.call('note', noteSchema, buildNotePrompt({ changes, facts, ...(previous ? { problems: previous } : {}) }))
    if (res.parsed === null) break
    const text = withoutInlineIds(res.parsed.text).trim()
    const factIds = [...new Set(res.parsed.factIds)]
    const coded = checkNote({ text, factIds }, { known, fresh: n.fresh, demoted: new Set(n.demoted.keys()) })
    const found = coded.length > 0 ? null : await checkedNote({ text, factIds }, checkFacts, n.ctx, n.research)
    if (found === 'skipped') break
    if (found) {
      counts.checked++
      if (found.problems.some(p => p.kind === 'copying')) counts.copied++
      if (found.unsupported) counts.unsupported++
    }
    const problems = found ? found.problems.map(p => p.problem) : coded
    if (problems.length === 0) {
      record.note = { text, fallback: false, problems: [], ...counts }
      return cite(text, factIds)
    }
    previous = { text, problems }
    record.note = { text, fallback: true, problems, ...counts }
  }

  // The fixed line, citing the new or demoted facts the changed sections rest on, and naming their outlets
  const newer = offered.filter(ref => n.fresh.has(ref) || n.demoted.has(ref))
  const outletRefs = [...newer, ...founding.flatMap(ref => (n.fresh.has(ref) ? [ref] : (n.demotedNow.get(ref)?.contradictedBy ?? [])))]
  const outlets = outletRefs.flatMap(ref => {
    const f = byRef.get(ref)
    return f && !n.demoted.has(ref) ? [sources.get(f.sourceRef)?.outlet ?? ''] : []
  })
  const text = fallbackNote(n.changes, outlets)
  record.note = { text, fallback: true, problems: record.note?.problems ?? [], ...counts }
  return cite(text, newer)
}

/**
 * The note's fact check and both copying checks, as a story paragraph's: their problems, and whether
 * the fact check found the note unsupported (a failed call is a problem, not that verdict); `skipped`
 * when the budget skipped the call.
 */
async function checkedNote(
  note: { text: string; factIds: string[] },
  facts: ReadonlyMap<string, CitableFact>,
  ctx: CheckContext,
  call: StepCaller,
): Promise<{ problems: Pick<CitationProblem, 'problem' | 'kind'>[]; unsupported: boolean } | 'skipped'> {
  const item: DraftItem = { part: 'note', label: NOTE_LABEL, text: note.text, cited: true, factIds: note.factIds }
  const evidence = evidenceFor(note.factIds, facts)
  const hints = numberHints(note.text, evidence)
  const lines = sourceLines(ctx.sources)
  const copying = checkCopying([item], ctx.sources, config.research.copiedRunWords)
  const res = await call(
    'fact-check',
    factCheckSchema,
    buildFactCheckPrompt([{ label: NOTE_LABEL, text: note.text, facts: evidence, numbersNotFound: hints }], lines, [...facts.values()]),
  )
  if (res.outcome === 'skipped') return 'skipped'
  if (res.parsed === null) return { problems: [...copying.problems, { problem: `fact-check: ${res.outcome}`, kind: 'fact' }], unsupported: false }
  const judged = judgedProblems(res.parsed, [{ item, evidence, numberHints: hints }], lines)
  return { problems: [...copying.problems, ...judged], unsupported: judged.some(p => p.kind === 'fact') }
}
