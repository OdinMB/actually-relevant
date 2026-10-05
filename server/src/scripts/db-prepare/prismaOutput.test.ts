import { describe, it, expect } from 'vitest'
import { classifyGenerateFailure, classifyMigrateFailure, summarizeMigrateSuccess } from './prismaOutput.js'

describe('classifyGenerateFailure', () => {
  it.each([
    "EPERM: operation not permitted, rename 'C:\\x\\query_engine-windows.dll.node.tmp123' -> 'C:\\x\\query_engine-windows.dll.node'",
    'Error: EBUSY: resource busy or locked, unlink query_engine-windows.dll.node',
  ])('recognizes a locked client file: %s', (output) => {
    expect(classifyGenerateFailure(output)).toBe('locked')
  })

  it('reports anything else as other', () => {
    expect(classifyGenerateFailure('Error validating model "Story": unknown type')).toBe('other')
  })
})

describe('classifyMigrateFailure', () => {
  it('recognizes an unreachable database (P1001)', () => {
    expect(classifyMigrateFailure("Error: P1001: Can't reach database server at `localhost:5433`")).toBe('unreachable')
  })

  it('recognizes a failed migration recorded in the database (P3009)', () => {
    expect(classifyMigrateFailure('Error: P3009\n\nmigrate found failed migrations in the target database')).toBe('failed-migration')
  })

  it('recognizes a migration that failed while applying (P3018)', () => {
    expect(classifyMigrateFailure('Error: P3018\n\nA migration failed to apply.')).toBe('failed-migration')
  })

  it('reports anything else as other', () => {
    expect(classifyMigrateFailure('Error: P1000: Authentication failed')).toBe('other')
  })
})

describe('summarizeMigrateSuccess', () => {
  it('reports up to date when nothing was pending', () => {
    expect(summarizeMigrateSuccess('28 migrations found in prisma/migrations\n\nNo pending migrations to apply.')).toEqual({
      applied: [],
    })
  })

  it('lists the migrations it applied', () => {
    const output = [
      '29 migrations found in prisma/migrations',
      '',
      'Applying migration `20261005120000_add_thing`',
      'Applying migration `20261005130000_add_other`',
      '',
      'The following migration(s) have been applied:',
      '',
      'migrations/',
      '  └─ 20261005120000_add_thing/',
      '    └─ migration.sql',
      '',
      'All migrations have been successfully applied.',
    ].join('\n')
    expect(summarizeMigrateSuccess(output)).toEqual({
      applied: ['20261005120000_add_thing', '20261005130000_add_other'],
    })
  })
})
