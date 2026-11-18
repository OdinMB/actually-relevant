/**
 * Research's one monthly cap, shared by research runs and research passes (`.context/research-passes.md`,
 * "Budget"; ADR-0067): the month's spend counts both, and both reserve under one advisory lock, so a
 * run and a pass started at once never pass the cap together. While no pass runs, the sum is research's
 * alone, as it was.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { utcMonthStart } from './podcastGuards.js'

/** Arbitrary constant key of the transaction-level advisory lock that serialises research's reservations, runs and passes alike (not the TTS one). */
export const RESEARCH_RESERVATION_LOCK = 7_303_201

type Db = Prisma.TransactionClient | typeof prisma

/**
 * USD of every research run and research pass started this UTC month, deleted stories' included, a
 * running one at its reservation; `except` leaves out the run or pass whose own spend its meter counts.
 */
export async function monthToDateUsd(db: Db, now: Date, except: { runId?: string; passId?: string } = {}): Promise<number> {
  const since = utcMonthStart(now)
  const [runs, passes] = await Promise.all([
    db.storyResearchRun.aggregate({ _sum: { costUsd: true }, where: { startedAt: { gte: since }, ...(except.runId ? { id: { not: except.runId } } : {}) } }),
    db.researchPass.aggregate({ _sum: { costUsd: true }, where: { startedAt: { gte: since }, ...(except.passId ? { id: { not: except.passId } } : {}) } }),
  ])
  return (runs._sum.costUsd ?? 0) + (passes._sum.costUsd ?? 0)
}
