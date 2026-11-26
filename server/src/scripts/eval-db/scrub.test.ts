import { describe, it, expect } from 'vitest'
import { ACTOR_PLACEHOLDER, UnclassifiedColumns, checkSourceColumns, scrubActor, scrubActorsInJson, scrubRow } from './scrub.js'
import type { ExportedTable } from './tables.js'

const EDITOR_ID = '6f1c2b8e-1d3a-4c55-9a7e-0b2f4d6a8c10'

describe('scrubActor', () => {
  it.each(['pipeline', 'review', 'recenter', 'burst', 'editor'])('keeps the system marker %s', marker => {
    expect(scrubActor(marker)).toBe(marker)
  })

  it('keeps a null', () => {
    expect(scrubActor(null)).toBeNull()
  })

  it.each([EDITOR_ID, 'odin@example.org', 'Odin', 'Pipeline', '', 42])('replaces %j with the placeholder', value => {
    expect(scrubActor(value)).toBe(ACTOR_PLACEHOLDER)
  })
})

describe('scrubActorsInJson', () => {
  it("replaces an actor key's value at any depth and leaves every other key alone", () => {
    const inputs = {
      target: null,
      actor: EDITOR_ID,
      changes: [
        { table: 'entry', id: 'e1', before: { status: 'active', detachedBy: null }, after: { status: 'detached', detachedBy: EDITOR_ID } },
        { table: 'overview', id: 'o1', before: { frozenBy: 'burst', recenteredBy: 'odin@example.org' }, after: { frozen_by: EDITOR_ID } },
      ],
      candidates: [{ id: 'o2', distance: 0.25, joinedBy: 'pipeline', undoneBy: EDITOR_ID }],
      note: EDITOR_ID,
    }
    expect(scrubActorsInJson(inputs)).toEqual({
      target: null,
      actor: 'editor',
      changes: [
        { table: 'entry', id: 'e1', before: { status: 'active', detachedBy: null }, after: { status: 'detached', detachedBy: 'editor' } },
        { table: 'overview', id: 'o1', before: { frozenBy: 'burst', recenteredBy: 'editor' }, after: { frozen_by: 'editor' } },
      ],
      candidates: [{ id: 'o2', distance: 0.25, joinedBy: 'pipeline', undoneBy: 'editor' }],
      // Only the actor keys are read: an id under another key is not a person's marker
      note: EDITOR_ID,
    })
  })

  it('leaves scalars and null as they are', () => {
    expect(scrubActorsInJson(null)).toBeNull()
    expect(scrubActorsInJson('text')).toBe('text')
    expect(scrubActorsInJson([1, 'a'])).toEqual([1, 'a'])
  })
})

const TABLE: ExportedTable = {
  table: 'overview_entries',
  key: 'id',
  deferred: [],
  keep: ['id', 'shared'],
  scrub: { detached_by: 'actor', inputs: 'actorsInJson' },
}

describe('scrubRow', () => {
  it('carries kept columns as they are and scrubs the rest by their rule, counting the values replaced', () => {
    const tally = new Map<string, number>()
    const row = {
      id: 'e1',
      shared: { cause: { story: EDITOR_ID } },
      detached_by: EDITOR_ID,
      inputs: { actor: EDITOR_ID, changes: [{ after: { detachedBy: 'review' } }] },
    }
    expect(scrubRow(TABLE, row, tally)).toEqual({
      id: 'e1',
      shared: { cause: { story: EDITOR_ID } },
      detached_by: 'editor',
      inputs: { actor: 'editor', changes: [{ after: { detachedBy: 'review' } }] },
    })
    expect(Object.fromEntries(tally)).toEqual({ 'overview_entries.detached_by': 1, 'overview_entries.inputs': 1 })
    expect(scrubRow(TABLE, { id: 'e2', shared: null, detached_by: 'pipeline', inputs: {} }, tally)).toEqual({
      id: 'e2',
      shared: null,
      detached_by: 'pipeline',
      inputs: {},
    })
    expect(tally.get('overview_entries.detached_by')).toBe(1)
  })

  it('refuses a column the classification does not name', () => {
    expect(() => scrubRow(TABLE, { id: 'e1', approved_by: EDITOR_ID }, new Map())).toThrow(UnclassifiedColumns)
  })
})

describe('checkSourceColumns', () => {
  const other: ExportedTable = { table: 'overview_stands', key: 'id', deferred: [], keep: ['id'], scrub: {} }

  it('notes the tables and classified columns the source database lacks', () => {
    const source = new Map([['overview_entries', ['id', 'shared', 'detached_by']]])
    expect(checkSourceColumns([TABLE, other], source)).toEqual({ absentTables: ['overview_stands'], absentColumns: ['overview_entries.inputs'] })
  })

  it('refuses a source column the classification does not name, naming every one', () => {
    const source = new Map([
      ['overview_entries', ['id', 'shared', 'detached_by', 'inputs', 'approved_by']],
      ['overview_stands', ['id', 'editor_email']],
    ])
    expect(() => checkSourceColumns([TABLE, other], source)).toThrow(UnclassifiedColumns)
    expect(() => checkSourceColumns([TABLE, other], source)).toThrow(/overview_entries\.approved_by, overview_stands\.editor_email/)
  })
})
