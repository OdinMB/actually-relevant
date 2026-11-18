/**
 * Where a story's cards come from (`.context/research-passes.md`, "Cards"): the newest research pass
 * that wrote any, its boxes citing the story's pool (a fact a pass or an editor demoted marked so,
 * as a demoted context fact is), else the newest context run's boxes and facts (`contextRecords`).
 * One answer for the page, the admin and its edits. Until a pass runs no story has pass boxes, so
 * every story's cards are its context run's, as before passes. Reads only.
 */
import type { ContextBox, PrismaClient } from '@prisma/client'
import { isContextSlot, type ContextSlot } from '../schemas/storyContext.js'
import { loadPool, newestPassBoxes } from './passRecords.js'
import type { ResearchDb } from './researchInput.js'
import { cardFacts } from './researchPool.js'
import { contextRecords, type RecordsDb, type StoredContextFact } from './storyContextRecords.js'

/** A card as the page and the admin read it: a context box's columns, which a pass box shares. */
export type CardBox = Pick<
  ContextBox,
  | 'id'
  | 'position'
  | 'heading'
  | 'teaser'
  | 'sentences'
  | 'visual'
  | 'asOf'
  | 'asOfPrecision'
  | 'place'
  | 'placeByEditor'
  | 'status'
  | 'model'
  | 'promptVersion'
  | 'writtenAt'
> & { type: ContextSlot }

export interface CardRecords {
  /** In order. */
  boxes: CardBox[]
  /** By ref. */
  facts: Map<string, StoredContextFact>
  /** The pass that wrote the cards; null for a context run's cards, or none. */
  pass: { id: string; number: number; writtenAt: Date } | null
}

/** What `cardRecords` reads through: the app's client. */
export type CardsDb = RecordsDb & ResearchDb & Pick<PrismaClient, 'passBox' | 'researchPass'>

const isSlotCard = <B extends Omit<CardBox, 'type'> & { type: string }>(box: B): box is B & { type: ContextSlot } => isContextSlot(box.type)

/** The story's served cards and the facts they cite: the newest pass's, else the newest context run's. */
export async function cardRecords(db: CardsDb, storyId: string): Promise<CardRecords> {
  const boxes = (await newestPassBoxes(db, storyId)).filter(isSlotCard)
  const newest = boxes[0]
  if (!newest) return { ...(await contextRecords(db, storyId)), pass: null }
  const [pool, pass] = await Promise.all([
    loadPool(db, storyId),
    db.researchPass.findUnique({ where: { id: newest.passId }, select: { id: true, number: true } }),
  ])
  const byRef = new Map(pool.facts.map(f => [f.ref, f]))
  const facts = new Map(
    cardFacts(pool).map((f): [string, StoredContextFact] => {
      const row = byRef.get(f.ref)
      return [f.ref, { ...f, id: row?.id ?? '', demoted: row?.status === 'demoted' }]
    }),
  )
  return { boxes, facts, pass: pass && { ...pass, writtenAt: newest.writtenAt } }
}
