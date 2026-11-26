import { describe, it, expect } from 'vitest'
import { evalDatabaseRefusal } from './guard.js'

describe('evalDatabaseRefusal', () => {
  it.each([
    'postgresql://postgres:postgres@localhost:5432/actually_relevant_eval',
    'postgres://u:p@127.0.0.1/ar_eval?schema=public',
    'postgresql://u:p@[::1]:5433/scratch_eval',
  ])('accepts the local database %s', url => {
    expect(evalDatabaseRefusal(url)).toBeNull()
  })

  it('refuses when no URL is given', () => {
    expect(evalDatabaseRefusal(undefined)).toMatch(/EVAL_DATABASE_URL is not set/)
    expect(evalDatabaseRefusal('  ')).toMatch(/not set/)
  })

  it.each([
    ['a managed host', 'postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com/actually_relevant_eval'],
    ['a LAN address', 'postgresql://u:p@192.168.1.20:5432/actually_relevant_eval'],
    ['a host given as a parameter', 'postgresql://u:p@localhost/actually_relevant_eval?host=db.example.com'],
    ['an unparseable URL', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(evalDatabaseRefusal(url)).toMatch(/EVAL_DATABASE_URL must point at a local database/)
  })

  it.each(['actually_relevant_dev', 'actually_relevant_test', 'actually_relevant_synthetic', 'actually_relevant', 'eval_prod'])(
    'refuses the local database named %s',
    name => {
      expect(evalDatabaseRefusal(`postgresql://u:p@localhost:5432/${name}`)).toMatch(new RegExp(`ends in "_eval" \\(got "${name}"\\); the import empties it`))
    },
  )
})
