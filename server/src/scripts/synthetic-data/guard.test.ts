import { describe, it, expect } from 'vitest'
import { syntheticDatabaseRefusal } from './guard.js'

describe('syntheticDatabaseRefusal', () => {
  it.each([
    'postgresql://ardev:ardev_local@localhost:5433/actually_relevant_synthetic',
    'postgres://u:p@127.0.0.1/ar_synthetic?schema=public',
    'postgresql://u:p@[::1]:5433/demo_synthetic',
  ])('accepts the local database %s', url => {
    expect(syntheticDatabaseRefusal(url)).toBeNull()
  })

  it('refuses when no URL is given', () => {
    expect(syntheticDatabaseRefusal(undefined)).toMatch(/not set/)
    expect(syntheticDatabaseRefusal('  ')).toMatch(/not set/)
  })

  it.each([
    ['a managed host', 'postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com/actually_relevant_synthetic'],
    ['a LAN address', 'postgresql://u:p@192.168.1.20:5432/actually_relevant_synthetic'],
    ['an unparseable URL', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(syntheticDatabaseRefusal(url)).toMatch(/must point at a local database/)
  })

  it.each(['actually_relevant_dev', 'actually_relevant_test', 'actually_relevant', 'synthetic_prod'])('refuses the local database named %s', name => {
    expect(syntheticDatabaseRefusal(`postgresql://u:p@localhost:5433/${name}`)).toMatch(new RegExp(`ends in "_synthetic" \\(got "${name}"\\)`))
  })
})
