/**
 * A research pass's result put into the story's state (`.context/research-passes.md`, "Applying a
 * pass"): the pass applies itself, the nightly pass and an editor's alike (plan, For Odin 3). One
 * transaction writes the pass's rows (`storePassResult`: the pass row, its searches, sources, facts,
 * judgments, version and cards) and, when the pass made a version, the story's columns and projection
 * through research's fenced write (`researchWrites.ts`'s `fencedWrite`), so neither lands without the
 * other. Every story write is fenced on the story as read before the pass: an editor's move or edit
 * during the pass wins, and the pass's rows are then stored without its version. A pipeline pass's
 * first `stale` or `contradicted` verdict rejects the story (`rejectForVerdict`), which takes only a
 * selected story; an editor's never rejects: the verdict stays on the pass, for the editor to act on;
 * a first pass on a published story is recorded as an Update (For Odin 5, `firstPassUpdate`), and a
 * later pass's rewrite before publication is none (`versionForReaders`). A later
 * pass that could not fix what it found wrong (`update_failed`) keeps the article and raises one
 * admin notice; nothing is unpublished or rejected. Never throws a refusal: an embedding or database
 * error throws.
 */
import { Prisma } from '@prisma/client'
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import prisma from '../lib/prisma.js'
import { firstPassUpdate, versionForReaders, versionValues } from './articleVersions.js'
import { storePassResult, type PassRowResult, type PassWrite } from './passRecords.js'
import type { PassResult } from './researchPass.js'
import { snapshotForApply } from './researchSwap.js'
import { fencedWrite, fetchCitedFavicons, REJECTED_FOR, rejectForVerdict, rejects, storyColumns, whyChanged, type ReadState } from './researchWrites.js'
import type { Actor } from './storyLifecycle.js'

const log = createLogger('research_pass')

/**
 * What became of a pass's result: `applied` (its version is on the story), `rejected` (its verdict
 * rejected the selected story), `stored` (its rows stored, the story left as it is: no version, an
 * `unchanged` or `update_failed` later pass, a fallback, a budget stop, a technical failure, or an
 * editor's pass whose verdict would reject the story),
 * `skipped` (the story moved or was written during the pass, or the step was switched off: its rows
 * stored without its version), `dropped` (a restart marked the pass cut off first: nothing stored).
 */
export type PassApplied = 'applied' | 'rejected' | 'stored' | 'skipped' | 'dropped'

/** What became of the result, and why nothing was applied when it was `skipped` or `dropped` (null otherwise). */
export interface PassApply {
  applied: PassApplied
  why: string | null
}

const CUT_OFF = 'a restart marked the pass cut off before it was stored'

/** The pass row's columns from its result: a later pass stores no gate verdict; the cost is what the meter counted, both attempts included. */
export function passRow(result: PassResult, spentUsd: number): PassRowResult {
  return {
    status: result.status,
    outcome: result.outcome,
    verdict: result.kind === 'first' ? result.verdict.kind : null,
    modelUsd: result.modelUsd,
    credits: result.credits,
    costUsd: Math.max(spentUsd, result.modelUsd + result.credits * config.research.tavilyUsdPerCredit),
    record: result.record,
    error: result.error,
  }
}

/** Thrown inside the transaction when the pass was marked cut off: the story write rolls back with it. */
class PassCutOff extends Error {}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

export interface PassApplyInput {
  storyId: string
  passId: string
  actor: Actor
  /** The story as read before the pass. */
  read: ReadState
  result: PassResult
  /** What the meter counted for the pass. */
  spentUsd: number
  /** False once the step was switched off during the pass: its rows are stored, its version and verdict not applied. */
  applies: boolean
  now?: Date
}

/** Store the pass's rows with or without its version; false when the pass was marked cut off. The story's write takes the same timeout (`recordAnalysis`). */
async function store(w: PassWrite): Promise<boolean> {
  return prisma.$transaction(tx => storePassResult(tx, w), { timeout: config.database.transactionTimeoutMs })
}

export async function applyPass(input: PassApplyInput): Promise<PassApply> {
  const { storyId, passId, read, result } = input
  const now = input.now ?? new Date()
  const pass = passRow(result, input.spentUsd)
  const w: PassWrite = {
    storyId,
    passId,
    pool: result.pool,
    changed: result.changed,
    version: null,
    boxes: result.boxes,
    boxFacts: result.boxFacts,
    writer: result.writer,
    pass,
    now,
  }
  // `why` (nothing applied) is stored as the pass's error; a pass cut off first is dropped
  const stored = async (applied: PassApplied, why: string | null = null): Promise<PassApply> =>
    (await store(why ? { ...w, pass: { ...pass, error: pass.error ?? `not applied: ${why}` } } : w)) ? { applied, why } : { applied: 'dropped', why: CUT_OFF }

  if (!input.applies) return stored('skipped', 'the step was switched off during the pass')

  // A first pass's verdict against the story: an editor's pass records it on the pass and leaves the
  // story to the editor; the step's rejects it, only while it is still selected and unwritten
  if (result.kind === 'first' && rejects(result.verdict.kind)) {
    if (input.actor !== 'pipeline') return stored('stored')
    const { moved, why } = await rejectForVerdict(storyId, result.verdict.kind, read)
    log.info({ storyId, passId, reason: REJECTED_FOR[result.verdict.kind], moved }, 'research pass verdict rejects the story')
    return moved ? stored('rejected') : stored('skipped', why ?? 'the story changed during the pass')
  }

  if (!result.version) {
    const outcome = await stored('stored')
    if (outcome.applied !== 'dropped' && result.outcome === 'update_failed') await notifyUpdateFailed(storyId, result)
    return outcome
  }

  const story = await storyColumns(storyId)
  const changed = whyChanged(story, read)
  if (changed || !story) return stored('skipped', changed ?? 'the story was deleted during the pass')
  // Updates start with publication: a first pass on a story readers already have is one (the
  // single-source text stays readable), and a rewrite before publication is none
  const first = result.version
  const version = versionForReaders(first, read.status === 'published', () => firstPassUpdate(story, first, utcDay(now)))
  const columns = { research: asJson(version.research), preResearch: asJson(snapshotForApply(story.preResearch, story)) }
  let written: boolean
  try {
    written = await fencedWrite(storyId, input.actor, read, versionValues(version), columns, async tx => {
      if (!(await storePassResult(tx, { ...w, version }))) throw new PassCutOff()
    })
  } catch (err) {
    if (err instanceof PassCutOff) return { applied: 'dropped', why: CUT_OFF }
    throw err
  }
  if (!written) return stored('skipped', 'the story changed during the pass')
  fetchCitedFavicons(version.research, new Map(result.pool.sources.map(s => [s.ref, s.favicon])))
  log.info({ storyId, passId, kind: result.kind, actor: input.actor }, 'research pass applied')
  return { applied: 'applied', why: null }
}

/** One notice a story, reopened by the next such pass: the article stays as it was, which a person reads. */
async function notifyUpdateFailed(storyId: string, result: PassResult): Promise<void> {
  const row = await prisma.story.findUnique({ where: { id: storyId }, select: { title: true } })
  const update = result.record.update
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: `Research found the story out of date and could not fix it: ${row?.title ?? storyId}`,
    message:
      `A newer fact makes ${update?.failedOn ?? 'a section'} wrong or substantially different, and the rewrite did not pass its checks, ` +
      'so the article stays as it was. Nothing was unpublished. Read the story and correct it by hand, or research it again.',
    link: `/admin/stories/${storyId}`,
    dedupeKey: `research-update-failed:${storyId}`,
  })
}
