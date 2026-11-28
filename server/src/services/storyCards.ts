/**
 * Where a story's cards come from (`.context/research-passes.md`, "The cards a pass writes"): the
 * newest research pass that wrote any, its boxes citing the story's pool (a fact a pass or an editor
 * demoted marked so, as a demoted context fact is), else the newest context run's boxes and facts
 * (`contextRecords`). One answer for the page, the admin and its edits; what readers get of it is
 * `readerCardRecords`, which serves none of a pass's cards while the card gate is closed
 * (`CARD_EVAL_GATE`), and every reader path takes it (a fence test holds it,
 * `test/passCardReaders.test.ts`). Until a pass runs no story has pass boxes, so every story's cards
 * are its context run's, as before passes. Reads only.
 */
import type { ContextBox, PrismaClient } from '@prisma/client'
import { isContextSlot, type ContextSlot } from '../schemas/storyContext.js'
import { CARD_EVAL_GATE } from './cardGate.js'
import { loadCitedFacts, newestPassBoxes } from './passRecords.js'
import type { ResearchDb } from './researchInput.js'
import { cardFacts } from './researchPool.js'
import { boxContent, boxRefs, contextRecords, type RecordsDb, type StoredContextFact } from './storyContextRecords.js'

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

/**
 * The story's served cards and the facts they cite: the newest pass's, else the newest context run's.
 * A pass's cards read only the pool facts some card of theirs cites (`loadCitedFacts`), hidden cards'
 * included, never the whole pool: every reader looks a fact up by a ref a card cites.
 */
export async function cardRecords(db: CardsDb, storyId: string): Promise<CardRecords> {
  const boxes = (await newestPassBoxes(db, storyId)).filter(isSlotCard)
  const newest = boxes[0]
  if (!newest) return { ...(await contextRecords(db, storyId)), pass: null }
  const cited = [...new Set(boxes.flatMap(b => boxRefs(boxContent(b))))]
  const [pool, pass] = await Promise.all([
    loadCitedFacts(db, storyId, cited),
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

/**
 * Why readers see none of these cards, whatever each one's status, or null: a research pass's while
 * the card gate is closed. A context run's cards are never held back here: their step has its own
 * switch (`build_story_context`, off), and an editor's "Gather context" shows them as before.
 */
export function readersRefusal(records: Pick<CardRecords, 'pass'>, gate: string | null = CARD_EVAL_GATE): string | null {
  return records.pass && gate ? `Research passes' cards stay off the story page: ${gate}` : null
}

/**
 * The cards readers get: `cardRecords`, with no box while `readersRefusal` holds them back. A story
 * whose newest cards are a pass's then serves none, never its older context run's in their place: the
 * cards an editor sees and edits are the ones readers would get.
 */
export async function readerCardRecords(db: CardsDb, storyId: string): Promise<CardRecords> {
  const records = await cardRecords(db, storyId)
  return readersRefusal(records) ? { ...records, boxes: [] } : records
}
