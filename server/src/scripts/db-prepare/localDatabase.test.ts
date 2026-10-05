import { describe, it, expect } from 'vitest'
import { checkLocalDatabase } from './localDatabase.js'

describe('checkLocalDatabase', () => {
  it.each([
    'postgresql://u:p@localhost:5433/actually_relevant_dev',
    'postgres://u:p@LOCALHOST:5432/db',
    'postgresql://u:p@127.0.0.1:5433/db?schema=public',
    'postgresql://u:p@[::1]:5433/db',
  ])('treats %s as local', (url) => {
    expect(checkLocalDatabase(url)).toMatchObject({ kind: 'local' })
  })

  it.each([
    ['a managed host', 'postgresql://u:p@dpg-abc123-a.frankfurt-postgres.render.com/db'],
    ['a LAN address', 'postgresql://u:p@192.168.1.20:5432/db'],
    ['another loopback-looking address', 'postgresql://u:p@127.0.0.2:5432/db'],
    ['host.docker.internal', 'postgresql://u:p@host.docker.internal:5433/db'],
    ['a subdomain of localhost', 'postgresql://u:p@db.localhost:5433/db'],
    ['a hostname that only starts with localhost', 'postgresql://u:p@localhost.example.com/db'],
  ])('treats %s as remote', (_label, url) => {
    expect(checkLocalDatabase(url)).toMatchObject({ kind: 'remote' })
  })

  it('reports the host it judged', () => {
    expect(checkLocalDatabase('postgresql://u:p@db.example.com:5432/x')).toEqual({
      kind: 'remote',
      host: 'db.example.com',
    })
  })

  it('lets a host query parameter override the URL host, because Prisma connects there', () => {
    expect(checkLocalDatabase('postgresql://u:p@localhost:5433/db?host=db.example.com')).toMatchObject({
      kind: 'remote',
      host: 'db.example.com',
    })
  })

  it('treats a Unix socket path in the host parameter as local', () => {
    expect(checkLocalDatabase('postgresql://u:p@localhost/db?host=/var/run/postgresql')).toMatchObject({
      kind: 'local',
    })
  })

  it('treats several host parameters as remote, whichever one comes first', () => {
    expect(checkLocalDatabase('postgresql://u:p@localhost/db?host=/tmp&host=db.example.com')).toMatchObject({
      kind: 'remote',
    })
  })

  it('treats a hostaddr parameter as remote', () => {
    expect(checkLocalDatabase('postgresql://u:p@localhost/db?hostaddr=10.0.0.5')).toMatchObject({ kind: 'remote' })
  })

  it('reports a missing URL as missing', () => {
    expect(checkLocalDatabase(undefined)).toEqual({ kind: 'missing' })
    expect(checkLocalDatabase('   ')).toEqual({ kind: 'missing' })
  })

  it('treats an unparseable URL as remote rather than guessing', () => {
    expect(checkLocalDatabase('not a url')).toMatchObject({ kind: 'remote' })
  })

  it('treats a non-postgres scheme such as Accelerate as remote', () => {
    expect(checkLocalDatabase('prisma://localhost/?api_key=x')).toMatchObject({ kind: 'remote' })
  })
})
