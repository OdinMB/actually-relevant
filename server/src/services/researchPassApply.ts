/**
 * A research pass's result put into the story's state (`.context/research-passes.md`, "Applying a
 * pass"): the pass applies itself, the nightly pass and an editor's alike (plan, For Odin 3). One
 * transaction writes the pass's rows (`storePassResult`: the pass row, its searches, sources, facts,
 * judgments, version and cards) and, when the pass made a version, the story's columns and projection
 * through research's fenced write (`researchApply.ts`'s `write`), so neither lands without the other.
 * Every story write is fenced on the story as read before the pass: an editor's move or edit during
 * the pass wins, and the pass's rows are then stored without its version. A first pass's `stale` or
 * `contradicted` verdict rejects the story through `transition`, which takes only a selected story;
 * a first pass on a published story is recorded as an Update (For Odin 5, `firstPassUpdate`). A later
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
import { firstPassUpdate, versionValues } from './articleVersions.js'
import { storePassResult, type PassRowResult, type PassWrite } from './passRecords.js'
import { REJECTED_FOR, rejects, storyColumns, whyChanged, write, type ReadState } from './researchApply.js'
import type { PassResult } from './researchPass.js'
import type { ArticleVersionData, Pool } from './researchPool.js'
import { snapshotForApply } from './researchSwap.js'
import { fetchSourceFaviconsInBackground } from './sourceFavicons.js'
import { transition, type Actor } from './storyLifecycle.js'

const log = createLogger('research_pass')

/**
 * What became of a pass's result: `applied` (its version is on the story), `rejected` (its verdict
 * rejected the selected story), `stored` (its rows stored, the story left as it is: no version, an
 * `unchanged` or `update_failed` later pass, a fallback, a budget stop or a technical failure),
 * `skipped` (the story moved or was written during the pass, or the step was switched off: its rows
 * stored without its version), `dropped` (a restart marked the pass cut off first: nothing stored).
 */
export type PassApplied = 'applied' | 'rejected' | 'stored' | 'skipped' | 'dropped'

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

/** Store the pass's rows with or without its version; false when the pass was marked cut off. */
async function store(w: PassWrite): Promise<boolean> {
  return prisma.$transaction(tx => storePassResult(tx, w))
}

/** Each cited outside source's host, with the icon address the pool holds for it. */
function iconHints(version: ArticleVersionData, pool: Pool) {
  const favicons = new Map(pool.sources.map(s => [s.ref, s.favicon]))
  return version.research.sources.flatMap(s => (s.host ? [{ host: s.host, favicon: favicons.get(s.id) ?? null }] : []))
}

export async function applyPass(input: PassApplyInput): Promise<PassApplied> {
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
  const stored = async (outcome: PassApplied, error?: string): Promise<PassApplied> =>
    (await store(error ? { ...w, pass: { ...pass, error: pass.error ?? error } } : w)) ? outcome : 'dropped'

  if (!input.applies) return stored('skipped', 'not applied: the step was switched off during the pass')

  // A first pass's verdict against the story: rejected only while it is still selected and unwritten
  if (result.kind === 'first' && rejects(result.verdict.kind)) {
    const reason = REJECTED_FOR[result.verdict.kind]
    const changed = whyChanged(await storyColumns(storyId), read)
    const moved =
      !changed && (await transition([storyId], { to: 'rejected', reason }, 'pipeline', { where: { updatedAt: read.updatedAt } })).moved.includes(storyId)
    log.info({ storyId, passId, reason, moved }, 'research pass verdict rejects the story')
    return stored(moved ? 'rejected' : 'skipped', moved ? undefined : `not applied: ${changed ?? 'the story changed during the pass'}`)
  }

  if (!result.version) {
    const outcome = await stored('stored')
    if (outcome !== 'dropped' && result.outcome === 'update_failed') await notifyUpdateFailed(storyId, result)
    return outcome
  }

  const story = await storyColumns(storyId)
  const changed = whyChanged(story, read)
  if (changed || !story) return stored('skipped', `not applied: ${changed}`)
  // A first pass on a story readers already have is an Update: the single-source text stays readable
  const version: ArticleVersionData =
    result.kind === 'first' && read.status === 'published' ? { ...result.version, ...firstPassUpdate(story, result.version, utcDay(now)) } : result.version
  const columns = { research: asJson(version.research), preResearch: asJson(snapshotForApply(story.preResearch, story)) }
  let written: boolean
  try {
    written = await write(storyId, input.actor, read, versionValues(version), columns, async tx => {
      if (!(await storePassResult(tx, { ...w, version }))) throw new PassCutOff()
    })
  } catch (err) {
    if (err instanceof PassCutOff) return 'dropped'
    throw err
  }
  if (!written) return stored('skipped', 'not applied: the story changed during the pass')
  void fetchSourceFaviconsInBackground(iconHints(version, result.pool))
  log.info({ storyId, passId, kind: result.kind, actor: input.actor }, 'research pass applied')
  return 'applied'
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
