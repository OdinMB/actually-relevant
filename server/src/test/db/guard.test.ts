import { describe, it, expect } from 'vitest'
import { testDatabaseRefusal } from './guard.js'

describe('testDatabaseRefusal', () => {
  it('accepts a local database whose name contains "test"', () => {
    expect(testDatabaseRefusal('postgresql://u:p@localhost:5433/actually_relevant_test')).toBeNull()
    expect(testDatabaseRefusal('postgres://u:p@127.0.0.1/test_db?schema=public')).toBeNull()
  })

  it('refuses a remote host', () => {
    expect(testDatabaseRefusal('postgresql://u:p@db.render.com/actually_relevant_test')).toMatch(/local/)
  })

  it('refuses a local database without "test" in its name', () => {
    expect(testDatabaseRefusal('postgresql://u:p@localhost:5433/actually_relevant_dev')).toMatch(/"actually_relevant_dev"/)
  })
})
