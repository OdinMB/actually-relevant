import { describe, it, expect } from 'vitest'
import { testDatabaseRefusal } from './guard.js'

describe('testDatabaseRefusal', () => {
  it('accepts a local database whose name ends in "_test"', () => {
    expect(testDatabaseRefusal('postgresql://u:p@localhost:5433/actually_relevant_test')).toBeNull()
    expect(testDatabaseRefusal('postgres://u:p@127.0.0.1/ar_test?schema=public')).toBeNull()
  })

  it('refuses a remote host', () => {
    expect(testDatabaseRefusal('postgresql://u:p@db.render.com/actually_relevant_test')).toMatch(/local/)
  })

  it('refuses a local database whose name does not end in "_test"', () => {
    expect(testDatabaseRefusal('postgresql://u:p@localhost:5433/actually_relevant_dev')).toMatch(/"actually_relevant_dev"/)
    expect(testDatabaseRefusal('postgresql://u:p@localhost:5433/test_db')).toMatch(/"test_db"/)
  })

  it('refuses the database DATABASE_URL names', () => {
    const url = 'postgresql://u:p@localhost:5433/actually_relevant_test'
    expect(testDatabaseRefusal(url, 'postgresql://other:pw@localhost:5433/actually_relevant_test')).toMatch(/same database/)
  })

  it('accepts a test database next to a different development database', () => {
    expect(testDatabaseRefusal(
      'postgresql://u:p@localhost:5433/actually_relevant_test',
      'postgresql://u:p@localhost:5433/actually_relevant_dev',
    )).toBeNull()
  })
})
