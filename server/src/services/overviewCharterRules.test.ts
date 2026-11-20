import { describe, expect, it } from 'vitest'
import { NO_END_EVENT } from '../prompts/overviews.js'
import {
  amendCharter,
  answeredEndEvent,
  EDITOR_RIGHTS,
  firstJudgments,
  FOUNDING_RIGHTS,
  NO_CHARTER,
  RECENTER_RIGHTS,
  REVIEW_RIGHTS,
  type CharterHolder,
  type CharterRights,
} from './overviewCharterRules.js'
import type { Charter } from './overviewTypes.js'

const LIMITS = { maxTitleChars: 20, maxInChars: 40, maxOutEntries: 3, maxOutChars: 20, maxEndEventChars: 30 }

const current: CharterHolder = {
  title: 'Ebola in Ituri',
  charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'It is declared over' },
  lockedOut: ['cholera in Congo'],
}

const amend = (rights: CharterRights, charter: Partial<Charter> = {}, title = '') =>
  amendCharter(current, { title, charter: { ...current.charter, ...charter } }, rights, LIMITS)
const fields = (a: ReturnType<typeof amend>) => a.refusals.map(r => r.field)

describe('who may change what of a charter', () => {
  // Each writer on the same proposals: [what it proposes, refused by the review, the re-center, the editor]
  const cases: [string, Partial<Charter>, boolean, boolean, boolean][] = [
    ['a new IN', { in: 'Ebola anywhere in Congo.' }, true, false, false],
    ['a new END_EVENT', { endEvent: 'The WHO says it is over' }, true, false, false],
    ['no END_EVENT', { endEvent: null }, true, false, false],
    ['an OUT entry dropped', { out: [] }, true, true, false],
    ['an OUT entry added', { out: ['Ebola in Uganda', 'measles'] }, false, false, false],
    ['a locked-out entry named again', { out: ['Ebola in Uganda', 'Cholera in  Congo'] }, true, true, false],
    ['an OUT entry too long', { out: ['Ebola in Uganda', 'x'.repeat(21)] }, true, true, true],
    ['an IN too long', { in: 'x'.repeat(41) }, true, true, true],
    ['an END_EVENT too long', { endEvent: 'x'.repeat(31) }, true, true, true],
  ]
  for (const [what, charter, review, recenter, editor] of cases)
    it(`${what}: ${[review && 'a review', recenter && 'a re-center', editor && 'an editor'].filter(Boolean).join(', ') || 'no writer'} refuses it`, () => {
      expect(amend(REVIEW_RIGHTS, charter).refusals.length > 0).toBe(review)
      expect(amend(RECENTER_RIGHTS, charter).refusals.length > 0).toBe(recenter)
      expect(amend(EDITOR_RIGHTS, charter).refusals.length > 0).toBe(editor)
    })

  it('builds onto the current charter for a writer that may not drop OUT entries, whatever else it rewrote', () => {
    const review = amend(REVIEW_RIGHTS, { in: 'Ebola anywhere.', out: ['measles'] })
    expect(review.charter).toEqual({ in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'measles'], endEvent: 'It is declared over' })
    expect(review.outAdded).toEqual(['measles'])
    expect(review.refusals.map(r => r.reason)).toEqual([
      'rewrites IN: a review only adds to OUT',
      'drops OUT entries, which widens it and only an editor may: Ebola in Uganda',
    ])
    const recenter = amend(RECENTER_RIGHTS, { in: 'Ebola in Ituri and North Kivu.', endEvent: null, out: ['ebola in  uganda', 'measles'] })
    expect(recenter.charter).toEqual({ in: 'Ebola in Ituri and North Kivu.', out: ['Ebola in Uganda', 'measles'], endEvent: null })
    expect(recenter.refusals).toEqual([])
  })

  it('refuses each addition past the entries in all, keeping those before it', () => {
    const a = amend(RECENTER_RIGHTS, { out: ['Ebola in Uganda', 'measles', 'mpox', 'polio'] })
    expect(a.outAdded).toEqual(['measles', 'mpox'])
    expect(a.refusals).toEqual([{ field: 'out', reason: 'adds an OUT entry past 3 in all: polio' }])
  })

  it('takes the whole OUT list from an editor, and lifts the lock of a locked-out entry it names again', () => {
    const a = amend(EDITOR_RIGHTS, { out: ['Cholera in  Congo'] })
    expect(a.charter.out).toEqual(['Cholera in  Congo'])
    expect(a.lockedOut).toEqual([])
    expect(amend(RECENTER_RIGHTS, { out: ['Ebola in Uganda', 'measles'] }).lockedOut).toEqual(['cholera in Congo'])
    expect(fields(amend(EDITOR_RIGHTS, { out: ['a', 'b', 'c', 'd'] }))).toEqual(['out'])
  })

  it('retitles within the limit, keeps the title for none, and refuses one too long', () => {
    expect(amend(REVIEW_RIGHTS, {}, ' Ebola in North Kivu ').title).toBe('Ebola in North Kivu')
    expect(amend(REVIEW_RIGHTS, {}, '  ').title).toBe('Ebola in Ituri')
    const long = amend(RECENTER_RIGHTS, {}, 'x'.repeat(21))
    expect([long.title, long.refusals]).toEqual(['Ebola in Ituri', [{ field: 'title', reason: 'a title longer than 20 characters' }]])
  })

  it('holds a founding to the same limits on a charter of its own', () => {
    const found = (charter: Charter, title = 'Ebola') => amendCharter(NO_CHARTER, { title, charter }, FOUNDING_RIGHTS, LIMITS)
    expect(found({ in: 'Ebola in Ituri.', out: ['measles'], endEvent: null }).refusals).toEqual([])
    expect(fields(found({ in: 'x'.repeat(41), out: [], endEvent: 'x'.repeat(31) }, 'x'.repeat(21)))).toEqual(['title', 'in', 'end_event'])
    expect(fields(found({ in: 'Ebola.', out: ['a', 'b', 'c', 'x'.repeat(21)], endEvent: null }))).toEqual(['out', 'out'])
  })
})

describe('answeredEndEvent', () => {
  it('reads empty, none and the prompt’s none as no end event', () => {
    for (const text of ['', '  ', 'None', ` ${NO_END_EVENT}`]) expect(answeredEndEvent(text)).toBeNull()
    expect(answeredEndEvent(' It is declared over ')).toBe('It is declared over')
  })
})

describe('firstJudgments', () => {
  it('keeps each ref’s first judgment and lists the ones after it', () => {
    const { first, repeated } = firstJudgments([
      { id: 'E1', belongs: 'yes' },
      { id: ' E2', belongs: 'no' },
      { id: 'E1 ', belongs: 'no' },
    ])
    expect([...first].map(([id, a]) => [id, a.belongs])).toEqual([
      ['E1', 'yes'],
      ['E2', 'no'],
    ])
    expect(repeated).toEqual(['E1'])
  })
})
