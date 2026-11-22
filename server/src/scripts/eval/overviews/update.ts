/**
 * The `update` step of `eval:overviews` (`.plans/2026-11-17_research-passes.md`, "Evals and the
 * gate"): production's later-pass article step (`updateArticle`) on the fixtures
 * (`updateFixtures.ts`), `--repeat` times, then the strong judge on every Update note it served, and
 * the scores against the bars (`updateScore.ts`).
 *
 * The deps are research/pipeline.ts's: each step on its tier's constant arm, calls through the eval
 * context under versioned schema names (`pass-judge`, `pass-update`, `pass-note`, and research's for
 * the checks and repair rounds), run k ≥ 2 under its own cache key. No search: the new facts are the
 * fixtures'. Cases start only while the budget covers one more (`runStories`); the judge runs only
 * when its planned calls fit what is left (`callBudget.ts`), with plain schema names.
 */
import { draftItems } from '../../../services/researchChecks.js'
import { updateArticle } from '../../../services/researchPassLater.js'
import { versionedSchemaName } from '../models.js'
import { runNumbers } from '../repeats.js'
import { passCall } from '../research/pipeline.js'
import { runStories, type SkippedStory } from '../research/storyQueue.js'
import type { PlannedCall, SuiteContext } from '../types.js'
import { estimateCalls, refusal, type CallEstimate, type Ledger } from './callBudget.js'
import { JUDGE_ARM } from './contextJudge.js'
import type { Half } from './contextScore.js'
import { isLabelDevelopment } from './developmentHalves.js'
import type { KeyFile } from './keyFiles.js'
import { buildNoteJudgePrompt, noteJudgeSchema, type NoteJudgeInput } from './prompts.js'
import { UPDATE_CASE_KINDS, updateFixtures, updateSlugs, type UpdateCaseKind, type UpdateStory } from './updateFixtures.js'
import { scoreUpdates, type NoteVerdict, type UpdateRun, type UpdateScore } from './updateScore.js'

/** What one case may cost, reserved while it runs: the article step's judge, rewrite, checks, rounds and note, with room. */
export const UPDATE_RESERVE_USD = 0.1
/** A desk estimate of the note judge per case and run, for the dry run only: the real gate prices its planned calls. */
export const NOTE_JUDGE_DESK_USD = 0.02
/** Billed output expected of one note verdict, for the estimate only. */
const NOTE_JUDGE_OUTPUT_TOKENS = 300

const NOTE_SCHEMA = versionedSchemaName('overview-update-note', noteJudgeSchema)

export interface UpdateStepOptions {
  ctx: SuiteContext & Ledger
  files: KeyFile[]
  half: Half | 'all'
  limit?: number
  /** The researched stories by slug (`loadUpdateStoriesBySlug`, cached). */
  stories(slugs: string[]): Promise<Map<string, UpdateStory | null>>
  /** Whether uncached model calls can reach the API (the judge's gate). */
  canCall: boolean
  dryRun: boolean
  repeat: number
  concurrency: number
  budgetUsd: number
  onDone?: (run: UpdateRun) => void
}

export interface UpdateStepReport {
  half: Half | 'all'
  repeat: number
  limit?: number
  /** Keys without format errors. */
  keys: number
  /** Key files and stories left out, and why. */
  left: { what: string; reason: string }[]
  /** Stories with at least one case. */
  stories: number
  cases: Record<UpdateCaseKind, number>
  /** Changed figure values whose quote no section holds, left out of the expectations. */
  unplaced: number
  /** Dry run: the desk estimate of the cases and the judge; null once the step ran. */
  deskUsd: number | null
  skipped: SkippedStory[]
  judge: { estimate: CallEstimate; stopped: string | null } | null
  score: UpdateScore
}

/** What the strong judge reads of a case's served note: the changes, the facts they rest on, the note. */
export function noteJudgeInput(r: UpdateRun): NoteJudgeInput | null {
  const next = r.result.next
  const note = r.result.record.note
  if (!next || !note) return null
  const { pool, storyDay } = r.fixture.input
  const items = new Map(draftItems(next.article).map(i => [i.label, i]))
  const refs = new Set([...r.result.record.judgments.flatMap(j => j.founding), ...next.changes.flatMap(c => items.get(c.section)?.factIds ?? [])])
  const demoted = new Set(r.result.demoted.map(d => d.ref))
  const sources = new Map(pool.sources.map(s => [s.ref, s]))
  return {
    storyDay,
    changes: next.changes.map(c => ({ section: c.section, before: c.before?.text ?? '', after: c.after?.text ?? null })),
    facts: pool.facts
      .filter(f => refs.has(f.ref))
      .map(f => ({
        id: f.ref,
        statement: f.statement,
        outlet: sources.get(f.sourceRef)?.outlet ?? '',
        date: sources.get(f.sourceRef)?.date ?? null,
        contradicted: demoted.has(f.ref) || f.status === 'demoted',
      })),
    note: note.text,
  }
}

const planned = (input: NoteJudgeInput): PlannedCall => ({
  arm: JUDGE_ARM,
  schemaName: NOTE_SCHEMA,
  prompt: buildNoteJudgePrompt(input),
  baseOutputTokens: NOTE_JUDGE_OUTPUT_TOKENS,
})

/** The step: the fixtures, production's article step on each, then the note judge when its calls fit. */
export async function runUpdateStep(o: UpdateStepOptions): Promise<{ report: UpdateStepReport; runs: UpdateRun[] }> {
  // A label key only says what a story is for the linking evals (ADR-0073): its must entries are no development's here
  const keys = o.files.flatMap(f => (f.key && f.errors.length === 0 && !isLabelDevelopment(f.key.id) ? [f.key] : []))
  const left: UpdateStepReport['left'] = o.files
    .filter(f => !f.key || f.errors.length > 0)
    .map(f => ({ what: f.file, reason: `${f.errors.length} format errors: fix the key` }))
  const slugs = updateSlugs(keys, o.half)
  const stories = slugs.length === 0 ? new Map<string, UpdateStory | null>() : await o.stories(slugs)
  const fx = updateFixtures(keys, stories, { half: o.half, ...(o.limit !== undefined ? { limit: o.limit } : {}) })
  left.push(...fx.left.map(l => ({ what: l.slug, reason: l.reason })))
  const cases = Object.fromEntries(UPDATE_CASE_KINDS.map(k => [k, fx.fixtures.filter(f => f.kind === k).length])) as Record<UpdateCaseKind, number>
  const base = {
    half: o.half,
    repeat: o.repeat,
    ...(o.limit !== undefined ? { limit: o.limit } : {}),
    keys: keys.length,
    left,
    stories: new Set(fx.fixtures.map(f => f.slug)).size,
    cases,
    unplaced: fx.fixtures.reduce((n, f) => n + f.unplaced.length, 0),
  }
  if (o.dryRun) {
    const deskUsd = fx.fixtures.length * o.repeat * (UPDATE_RESERVE_USD + NOTE_JUDGE_DESK_USD)
    return { report: { ...base, deskUsd, skipped: [], judge: null, score: scoreUpdates([]) }, runs: [] }
  }

  const runs: UpdateRun[] = []
  const skipped: SkippedStory[] = []
  for (const run of runNumbers(o.repeat)) {
    const done = await runStories(
      fx.fixtures.map(fixture => ({ id: `${fixture.id}#${run}`, fixture })),
      {
        concurrency: o.concurrency,
        budgetUsd: o.budgetUsd,
        spentUsd: () => o.ctx.spentUsd(),
        storyUsd: () => UPDATE_RESERVE_USD,
        run: async ({ fixture }): Promise<UpdateRun> => {
          const call = passCall(o.ctx, run)
          return { fixture, run, result: await updateArticle(fixture.input, { call, research: call }), note: null }
        },
        onDone: (_item, r) => o.onDone?.(r),
      },
    )
    runs.push(...done.results)
    skipped.push(...done.skipped)
  }

  const asks = runs.map(r => ({ r, input: noteJudgeInput(r) }))
  const estimate = estimateCalls(
    o.ctx,
    asks.flatMap(a => (a.input ? [planned(a.input)] : [])),
  )
  const stopped = refusal(estimate, o.ctx, { budgetUsd: o.budgetUsd, canCall: o.canCall })
  const ask = async (input: NoteJudgeInput): Promise<NoteVerdict | null> => {
    const rec = await o.ctx.call(JUDGE_ARM, NOTE_SCHEMA, noteJudgeSchema, buildNoteJudgePrompt(input))
    return rec.outcome === 'ok' ? rec.parsed : null
  }
  const judged = stopped ? runs : await Promise.all(asks.map(async a => (a.input ? { ...a.r, note: await ask(a.input) } : a.r)))
  return { report: { ...base, deskUsd: null, skipped, judge: { estimate, stopped }, score: scoreUpdates(judged) }, runs: judged }
}
