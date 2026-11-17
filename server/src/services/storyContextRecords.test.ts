import { describe, it, expect } from 'vitest'
import { editorChoices, factKey } from './storyContextRecords.js'

describe('factKey', () => {
  const fact = { url: 'https://www.agency.example/report/', supportingSentence: 'Fires burned  2.88 million hectares.', statement: 'Fires burned 2.88m ha.' }

  it('names the same fact found twice alike, whatever its spacing, case or www', () => {
    expect(factKey(fact)).toBe(
      factKey({ url: 'https://agency.example/report', supportingSentence: 'fires burned 2.88 million hectares.', statement: 'Fires burned 2.88m ha. ' }),
    )
  })

  it('tells facts apart by their page, sentence or statement', () => {
    expect(factKey(fact)).not.toBe(factKey({ ...fact, url: 'https://agency.example/other' }))
    expect(factKey(fact)).not.toBe(factKey({ ...fact, supportingSentence: 'Fires burned 2.6 million hectares.' }))
    expect(factKey(fact)).not.toBe(factKey({ ...fact, statement: 'Fires burned 2.6m ha.' }))
  })
})

describe('editorChoices', () => {
  const box = (type: string, over: { status?: 'unreviewed' | 'reviewed' | 'demoted'; place?: string | null; placeByEditor?: boolean } = {}) => ({
    type: type as 'compared',
    status: over.status ?? 'unreviewed',
    place: over.place ?? null,
    placeByEditor: over.placeByEditor ?? false,
  })

  it('keeps a hidden card hidden and a moved card where the editor put it, matched by type', () => {
    const choice = editorChoices([
      box('compared', { status: 'demoted', place: 'P1' }),
      box('next', { place: 'W2', placeByEditor: true }),
      box('response', { status: 'demoted', place: null, placeByEditor: true }),
    ])
    expect(choice('compared')).toEqual({ status: 'demoted' })
    expect(choice('next')).toEqual({ place: 'W2', placeByEditor: true })
    expect(choice('response')).toEqual({ status: 'demoted', place: null, placeByEditor: true })
  })

  it("leaves the write call's choice alone where the editor made none, and for a type the earlier run lacked", () => {
    const choice = editorChoices([box('compared', { place: 'P2' }), box('figures', { status: 'reviewed' })])
    expect(choice('compared')).toEqual({})
    expect(choice('figures')).toEqual({})
    expect(choice('why_now')).toEqual({})
    expect(editorChoices([])('compared')).toEqual({})
  })
})
