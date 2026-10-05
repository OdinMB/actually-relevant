import { describe, it, expect } from 'vitest'
import { decidePreparation } from './gate.js'

const LOCAL = 'postgresql://u:p@localhost:5433/db'
const REMOTE = 'postgresql://u:p@dpg-abc.frankfurt-postgres.render.com/db'

describe('decidePreparation', () => {
  it('runs against a local database', () => {
    expect(decidePreparation({ DATABASE_URL: LOCAL })).toEqual({ action: 'run' })
  })

  it('never runs against a remote database', () => {
    expect(decidePreparation({ DATABASE_URL: REMOTE })).toEqual({
      action: 'skip-remote',
      host: 'dpg-abc.frankfurt-postgres.render.com',
    })
  })

  it('skips with a warning when DATABASE_URL is missing', () => {
    expect(decidePreparation({})).toEqual({ action: 'skip-missing' })
  })

  it.each(['1', 'true', 'TRUE', 'yes'])('honors SKIP_DB_PREPARE=%s', (value) => {
    expect(decidePreparation({ DATABASE_URL: LOCAL, SKIP_DB_PREPARE: value })).toEqual({ action: 'skip-requested' })
  })

  it.each(['', '0', 'false', 'no'])('does not skip for SKIP_DB_PREPARE=%j', (value) => {
    expect(decidePreparation({ DATABASE_URL: LOCAL, SKIP_DB_PREPARE: value })).toEqual({ action: 'run' })
  })
})
