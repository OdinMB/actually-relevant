import { describe, it, expect } from 'vitest'
import { assertReadOnly, classifyDb, readOnlyUrl } from './readOnlyDb.js'

describe('read-only session guard', () => {
  it('adds one connection and the URL-encoded read-only option', () => {
    expect(readOnlyUrl('postgresql://u:p@localhost:5432/db', true))
      .toBe('postgresql://u:p@localhost:5432/db?connection_limit=1&options=-c%20default_transaction_read_only%3Don')
  })

  it('appends with & when the URL already has parameters, replacing existing ones', () => {
    const url = readOnlyUrl('postgresql://u:p@db.example.com/app?sslmode=require&connection_limit=10&options=x', true)
    expect(url).toBe('postgresql://u:p@db.example.com/app?sslmode=require&connection_limit=1&options=-c%20default_transaction_read_only%3Don')
  })

  it('omits the startup option for the transaction fallback', () => {
    expect(readOnlyUrl('postgresql://u:p@localhost/db', false)).toBe('postgresql://u:p@localhost/db?connection_limit=1')
  })

  it('aborts unless transaction_read_only is on', () => {
    expect(() => assertReadOnly('on')).not.toThrow()
    expect(() => assertReadOnly('off')).toThrow(/read-only guard/)
    expect(() => assertReadOnly(undefined)).toThrow(/read-only guard/)
  })

  it('reports only local or remote', () => {
    expect(classifyDb('postgresql://u:p@localhost:5432/db')).toBe('local')
    expect(classifyDb('postgresql://u:p@127.0.0.1/db')).toBe('local')
    expect(classifyDb('postgresql://u:p@dpg-abc.oregon-postgres.render.com/db')).toBe('remote')
    expect(classifyDb('not a url')).toBe('remote')
  })
})
