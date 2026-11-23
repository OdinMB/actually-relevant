import { describe, expect, it } from 'vitest'
import { decisionMove, inputsSchema, linkInputs, readInputs, reviewInputs, storedChanges } from './overviewDecisions.js'

const change = { table: 'entry', id: 'e1', before: { status: 'active' }, after: { status: 'detached' } }

describe('the decision log schemas', () => {
  it("reads each kind's inputs by its own schema, a monthly audit's apart from a review's", () => {
    expect(inputsSchema('link', 'joined')).toBe(linkInputs)
    expect(inputsSchema('review', 'reviewed')).toBe(reviewInputs)
    expect(inputsSchema('review', 'audited')).not.toBe(reviewInputs)
    expect(inputsSchema('review', 'audit_failed')).toBe(inputsSchema('review', 'audited'))
  })

  it('fills what an older record lacks, and gives null for one that does not parse', () => {
    expect(readInputs(linkInputs, {})).toMatchObject({ reportsEndEvent: false, heldForRecenter: null, changes: [], created: [] })
    expect(readInputs(linkInputs, { shown: 'not a list' })).toBeNull()
  })

  it('gives the change set a decision stored, and none for one that stored none or does not parse', () => {
    expect(storedChanges('status', 'detached', { changes: [change] })).toEqual([change])
    expect(storedChanges('editor_detach', 'detached', { target: null, changes: [change] })).toEqual([change])
    expect(storedChanges('stands', 'written', { signature: 'x' })).toEqual([])
    expect(storedChanges('status', 'detached', { changes: 'nope' })).toEqual([])
  })

  it("names a status decision's move for the admin's history, and nothing for other kinds", () => {
    expect(decisionMove('status', { from: 'open', to: 'quiet', reason: 'quiet' })).toEqual({ from: 'open', to: 'quiet', reason: 'quiet' })
    expect(decisionMove('status', { reason: 'burst', joins: 6 })).toEqual({ from: null, to: null, reason: 'burst' })
    expect(decisionMove('review', { from: 'open', to: 'quiet' })).toBeNull()
  })
})
