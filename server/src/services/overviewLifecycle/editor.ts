/**
 * An editor's actions and Undo written (`.context/overviews.md`, "Editor actions and undo"): the plan
 * `overviewEdits.ts` makes from the overview's rows, read and locked in the same transaction. Refusals
 * are ServiceErrors (404 for an unknown overview, entry, story or decision; 409 otherwise).
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../lib/prisma.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'
import type { Rows } from '../overviewChanges.js'
import { planEdit, planUndo, type AttachStory, type EditContext, type EditorAction } from '../overviewEdits.js'
import { forgetOverviewLinks } from '../overviewCaches.js'
import { applyPlan, readRows, refusedByIndex, type Applied, type Tx } from './apply.js'

const context = (editorId: string, now: Date): EditContext => ({ editorId, now, newId: randomUUID })

async function overviewRows(tx: Tx, id: string): Promise<Rows> {
  const rows = await readRows(tx, id)
  if (!rows) throw new NotFoundError('Overview not found')
  return rows
}

/** What an attach reads of the story: published or not and when, the overview it is in now, and its newest detached row in this one. */
async function attachStory(tx: Tx, rows: Rows, storyId: string): Promise<AttachStory> {
  const story = await tx.story.findUnique({ where: { id: storyId }, select: { status: true, datePublished: true } })
  if (!story) throw new NotFoundError('Story not found')
  const active = await tx.overviewEntry.findFirst({ where: { storyId, status: 'active' }, select: { overviewId: true, overview: { select: { title: true } } } })
  const here = rows.entries
    .filter(e => e.storyId === storyId && e.status === 'detached')
    .sort((a, b) => (b.detachedAt?.getTime() ?? 0) - (a.detachedAt?.getTime() ?? 0))[0]
  return {
    id: storyId,
    published: story.status === 'published',
    datePublished: story.datePublished,
    activeIn: active ? { overviewId: active.overviewId, title: active.overview.title } : null,
    rowHere: here ?? null,
  }
}

/** A write in one transaction; once it commits, the public caches forget a link it took away. The one-active-entry index's refusal in the editor's words. */
async function written(db: typeof prisma, write: (tx: Tx) => Promise<Applied>): Promise<{ decisionId: string }> {
  try {
    const { decisionId, removed } = await db.$transaction(write)
    if (removed) forgetOverviewLinks()
    return { decisionId }
  } catch (error) {
    if (refusedByIndex(error)) throw new ConflictError('The story is in another overview now: reload the page')
    throw error
  }
}

/** An editor's action (`planEdit`), logged as its `editor_*` decision with the changes it made. */
export async function editorAction(action: EditorAction, editorId: string, db: typeof prisma = prisma): Promise<{ decisionId: string }> {
  const now = new Date()
  return written(db, async tx => {
    const rows = await overviewRows(tx, action.overviewId)
    let attach: AttachStory | null = null
    let entryId: string | null = null
    if (action.kind === 'detach' || action.kind === 'role') {
      if (!rows.entries.some(e => e.id === action.entryId)) throw new NotFoundError('Entry not found')
      entryId = action.entryId
    } else if (action.kind === 'attach') attach = await attachStory(tx, rows, action.storyId)
    return applyPlan(tx, rows, planEdit(action, rows, attach, entryId, context(editorId, now)), now)
  })
}

/**
 * Undo of one decision (`planUndo`): the decision marked undone by the editor, the undo logged as an
 * `undo` decision with its changes (so it can itself be undone, which makes the decision it undid live
 * again), applied whole or refused.
 */
export async function undoDecision(decisionId: string, editorId: string, db: typeof prisma = prisma): Promise<{ decisionId: string }> {
  const now = new Date()
  return written(db, async tx => {
    const d = await tx.overviewDecision.findUnique({
      where: { id: decisionId },
      select: { id: true, kind: true, outcome: true, storyId: true, overviewId: true, inputs: true, undoneAt: true },
    })
    if (!d) throw new NotFoundError('Decision not found')
    if (!d.overviewId) throw new ConflictError('The overview this decision was about is gone')
    const rows = await overviewRows(tx, d.overviewId)
    const plan = planUndo(d, rows, context(editorId, now))
    const marked = await tx.overviewDecision.updateMany({ where: { id: d.id, undoneAt: null }, data: { undoneAt: now, undoneBy: editorId } })
    if (marked.count === 0) throw new ConflictError('This decision is already undone')
    return applyPlan(tx, rows, plan, now)
  })
}
