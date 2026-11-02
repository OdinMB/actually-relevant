import { it, expect, vi, beforeEach, describe } from 'vitest'

vi.mock('./prisma.js', () => ({ default: {} }))

const { hasIterativeScan, nearestSettings, _resetIterativeScan } = await import('./vectors.js')

const clientWith = (extversion: string | null) => {
  const sql: string[] = []
  return {
    sql,
    $queryRaw: vi.fn(async () => (extversion === null ? [] : [{ extversion }])),
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?') + ' ' + JSON.stringify(values))
      return Promise.resolve(1)
    }),
  }
}

describe('filtered nearest-neighbour settings', () => {
  beforeEach(() => _resetIterativeScan())

  it.each([
    ['0.8.0', true],
    ['0.8.1', true],
    ['1.0.0', true],
    ['0.7.4', false],
    ['0.6.0', false],
    [null, false],
  ])('pgvector %s has iterative scans: %s', async (version, expected) => {
    expect(await hasIterativeScan(clientWith(version) as never)).toBe(expected)
  })

  it('reads the version once', async () => {
    const client = clientWith('0.8.0')
    await hasIterativeScan(client as never)
    await hasIterativeScan(client as never)
    expect(client.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('turns on the strict iterative scan only where pgvector has it', async () => {
    const modern = clientWith('0.8.0')
    await nearestSettings(modern as never, true)
    expect(modern.sql.join('\n')).toMatch(/hnsw\.ef_search[\s\S]*hnsw\.iterative_scan', 'strict_order'/)

    _resetIterativeScan()
    const old = clientWith('0.6.0')
    await nearestSettings(old as never, true)
    expect(old.sql.join('\n')).toContain('hnsw.ef_search')
    expect(old.sql.join('\n')).not.toContain('iterative_scan')
  })
})
