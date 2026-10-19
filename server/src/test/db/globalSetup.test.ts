import { describe, it, expect, vi } from 'vitest'
import { MISSING_TEST_DATABASE, prepareTestDatabase } from './globalSetup.js'

const TEST_URL = 'postgresql://u:p@localhost:5433/actually_relevant_test'

describe('prepareTestDatabase', () => {
  it('fails, rather than skipping, when TEST_DATABASE_URL is unset', () => {
    const migrate = vi.fn()
    expect(() => prepareTestDatabase({}, migrate)).toThrow(MISSING_TEST_DATABASE)
    expect(migrate).not.toHaveBeenCalled()
  })

  it('refuses before migrating when the test database is the development one', () => {
    const migrate = vi.fn()
    expect(() => prepareTestDatabase({ TEST_DATABASE_URL: TEST_URL, DATABASE_URL: TEST_URL }, migrate)).toThrow(/same database/)
    expect(migrate).not.toHaveBeenCalled()
  })

  it('migrates a guarded test database', () => {
    const migrate = vi.fn()
    prepareTestDatabase({ TEST_DATABASE_URL: TEST_URL, DATABASE_URL: 'postgresql://u:p@localhost:5433/actually_relevant_dev' }, migrate)
    expect(migrate).toHaveBeenCalledWith(TEST_URL)
  })
})
