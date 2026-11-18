/**
 * The article versions' status writes (`.context/research-passes.md`, "Versions and Updates"), each
 * in the transaction of the story write it belongs with (`AnalysisRow.also`): every version reverted
 * when the story goes back to its single-source analysis (a revert, a re-assess), and an undo's swap
 * of the current update for the version before it. Which version an undo restores is
 * `articleVersions.ts`'s (`undoPlan`); the story's own columns are `researchApply.ts`'s.
 */
import type { Prisma } from '@prisma/client'
import { ConflictError } from '../utils/errors.js'

/** Every version of the story reverted: none is current, and their Updates leave the page. */
export async function revertAllVersions(tx: Prisma.TransactionClient, storyId: string): Promise<void> {
  await tx.articleVersion.updateMany({ where: { storyId, status: { not: 'reverted' } }, data: { status: 'reverted' } })
}

/**
 * The undo's swap: the current update reverted, the version before it current again, both fenced
 * on the statuses read before (a 409 that rolls the story write back when either moved on: another
 * undo or a pass landed meanwhile). Reverted first, so one version is current at every step.
 */
export async function swapForUndo(tx: Prisma.TransactionClient, storyId: string, ids: { current: string; previous: string }): Promise<void> {
  const undone = await tx.articleVersion.updateMany({ where: { id: ids.current, storyId, status: 'current' }, data: { status: 'reverted' } })
  const restored = await tx.articleVersion.updateMany({ where: { id: ids.previous, storyId, status: 'superseded' }, data: { status: 'current' } })
  if (undone.count === 0 || restored.count === 0) throw new ConflictError('The story changed while this was written; reload it and try again')
}
