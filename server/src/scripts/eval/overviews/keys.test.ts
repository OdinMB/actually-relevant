/**
 * Committed answer keys can't rot: every `keys/*.json` passes the schema and `validateKey`, with no
 * database (the slugs, dates and quotes against the database are the `keys` step's). Each rule's
 * failure is shown on a small inline key.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseKey, validateKey, type AnswerKey } from './keySchema.js'
import { KEYS_DIR, keyFileNames, readKeyFile } from './keyFiles.js'

describe('the committed answer keys', () => {
  it('live in keys/, one JSON file per development', () => {
    expect(keyFileNames(KEYS_DIR).every(name => name.endsWith('.json'))).toBe(true)
  })

  for (const name of keyFileNames(KEYS_DIR)) {
    it(`${name} passes the schema and validateKey`, () => {
      expect(readKeyFile(join(KEYS_DIR, name)).errors).toEqual([])
    })
  }
})

const value = (figure: string, n: number, extra: Partial<AnswerKey['entries'][number]['values'][number]> = {}) => ({
  figure,
  value: n,
  approx: 'exact',
  asOf: '2026-06-01',
  matches: true,
  countedAs: null,
  quote: `${n} deaths`,
  ...extra,
})

function key(): Record<string, unknown> & { entries: Record<string, unknown>[]; nearMisses: Record<string, unknown>[] } {
  return {
    schemaVersion: 1,
    id: 'ebola-drc-2026',
    title: 'Ebola outbreak in eastern DR Congo',
    charter: { in: 'The outbreak declared in May 2026.', out: ['cholera in Congo'], endEvent: 'Declared over by the health ministry' },
    closed: null,
    figures: [{ key: 'deaths', name: 'Deaths', unit: 'people', definition: 'Confirmed and probable deaths, all countries', cumulative: true, variants: [] }],
    entries: [
      {
        slug: 'a',
        date: '2026-06-01',
        title: 'A',
        join: 'must',
        role: 'turning_point',
        kind: 'spread',
        values: [value('deaths', 100)],
        statuses: [],
        why: 'First report',
      },
      { slug: 'b', date: '2026-06-03', title: 'B', join: 'must', role: 'routine', kind: null, values: [value('deaths', 200)], statuses: [], why: 'Update' },
      {
        slug: 'c',
        date: '2026-06-03',
        title: 'C',
        join: 'optional',
        role: 'routine',
        kind: null,
        values: [value('deaths', 300)],
        statuses: [],
        why: 'Borderline',
      },
    ],
    nearMisses: [{ slug: 'x', date: '2026-06-02', title: 'X', why: 'Cholera, not Ebola' }],
    notes: '',
  }
}

const errorsOf = (json: unknown) => parseKey(json).errors

describe('parseKey', () => {
  it('accepts a complete key', () => {
    expect(errorsOf(key())).toEqual([])
  })

  it('takes a missing statuses or values list as empty, and a missing kind or countedAs as null', () => {
    const k = key()
    k.entries[1] = { slug: 'b', date: '2026-06-03', title: 'B', join: 'must', role: 'routine', why: 'Update' }
    k.entries[2]!.values = [value('deaths', 300), value('deaths', 400)].map(({ countedAs: _c, ...v }) => v)
    expect(errorsOf(k)).toEqual([])
  })

  it('rejects a date not written YYYY-MM-DD', () => {
    const k = key()
    k.entries[0]!.date = '2026-6-1'
    expect(errorsOf(k)).toEqual([expect.stringMatching(/^entries\.0\.date: /)])
  })

  it('rejects an unknown join, role or approx', () => {
    const k = key()
    k.entries[0]!.join = 'maybe'
    expect(errorsOf(k)).toEqual([expect.stringMatching(/^entries\.0\.join: /)])
  })
})

describe('validateKey', () => {
  const rule = (edit: (k: ReturnType<typeof key>) => void) => {
    const k = key()
    edit(k)
    return errorsOf(k)
  }

  it('wants entries in date order, each slug once', () => {
    expect(rule(k => (k.entries[2]!.date = '2026-05-30'))).toEqual(['entries not in date order at c (2026-05-30 after 2026-06-03)'])
    expect(rule(k => (k.entries[2]!.slug = 'b'))).toEqual(['entry b listed twice'])
  })

  it('wants a kind on every turning point and none on a routine entry', () => {
    expect(rule(k => (k.entries[0]!.kind = null))).toEqual(['turning point a has no kind'])
    expect(rule(k => (k.entries[1]!.kind = 'spread'))).toEqual(['routine entry b has a kind'])
  })

  it('wants every value to name a figure of the key, and every figure to have at least 3 values', () => {
    expect(rule(k => ((k.entries[0]!.values as object[])[0] = value('cases', 100)))).toEqual([
      'a: value for unknown figure cases',
      'figure deaths has 2 values, fewer than 3',
    ])
  })

  it('wants countedAs exactly on a value that does not match its figure', () => {
    expect(rule(k => ((k.entries[0]!.values as object[])[0] = value('deaths', 100, { matches: false })))).toEqual([
      'a: a value that does not match its figure needs countedAs',
    ])
    expect(rule(k => ((k.entries[0]!.values as object[])[0] = value('deaths', 100, { countedAs: 'DR Congo only' })))).toEqual([
      'a: countedAs is set on a value that matches its figure',
    ])
    expect(rule(k => ((k.entries[0]!.values as object[])[0] = value('deaths', 100, { matches: false, countedAs: 'DR Congo only' })))).toEqual([])
  })

  it('wants no slug both an entry and a near miss', () => {
    expect(rule(k => (k.nearMisses[0]!.slug = 'a'))).toEqual(['a is both an entry and a near miss'])
  })

  it('wants the closing story, when named, to be an entry', () => {
    expect(rule(k => (k.closed = { slug: 'x', date: '2026-07-01' }))).toEqual(['closed.slug x is not an entry'])
    expect(rule(k => (k.closed = { slug: 'c', date: '2026-07-01' }))).toEqual([])
    expect(rule(k => (k.closed = { slug: null, date: '2026-07-01' }))).toEqual([])
  })

  describe('responses (version 2)', () => {
    const response = (extra: Record<string, unknown> = {}) => ({
      date: '2026-06-02',
      what: 'WHO ring vaccination',
      slug: 'a',
      quote: 'ring vaccination',
      ...extra,
    })
    const v2 = (k: ReturnType<typeof key>, responses: object[]) => Object.assign(k, { schemaVersion: 2, responses })

    it('accepts sourced and unsourced responses in date order, and a version 1 key without any', () => {
      expect(rule(k => v2(k, [response(), response({ date: '2026-06-05', slug: null, quote: null })]))).toEqual([])
      expect(rule(k => v2(k, []))).toEqual([])
      expect(parseKey(key()).key?.responses).toEqual([])
    })

    it('wants responses only in a version 2 key', () => {
      expect(rule(k => Object.assign(k, { responses: [response()] }))).toEqual(['responses need schemaVersion 2'])
    })

    it('wants them in date order, each slug an entry, and a quote exactly with a slug', () => {
      expect(rule(k => v2(k, [response({ date: '2026-06-05' }), response()]))).toEqual([
        'responses not in date order at "WHO ring vaccination" (2026-06-02 after 2026-06-05)',
      ])
      expect(rule(k => v2(k, [response({ slug: 'x' })]))).toEqual(['response "WHO ring vaccination": slug x is not an entry'])
      expect(rule(k => v2(k, [response({ quote: null })]))).toEqual(['response "WHO ring vaccination": a quote goes with a slug, and none without one'])
      expect(rule(k => v2(k, [response({ slug: null })]))).toEqual(['response "WHO ring vaccination": a quote goes with a slug, and none without one'])
    })
  })

  it('reports every broken rule at once', () => {
    const parsed = parseKey(key()).key
    expect(parsed).not.toBeNull()
    expect(validateKey({ ...parsed!, figures: [], nearMisses: [{ slug: 'a', date: '2026-06-02', title: 'A', why: '' }] })).toEqual([
      'a: value for unknown figure deaths',
      'b: value for unknown figure deaths',
      'c: value for unknown figure deaths',
      'a is both an entry and a near miss',
    ])
  })
})

describe('readKeyFile', () => {
  let dir: string | null = null
  const write = (name: string, text: string) => {
    dir ??= mkdtempSync(join(tmpdir(), 'overview-keys-'))
    writeFileSync(join(dir, name), text)
    return join(dir, name)
  }
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('reads a key whose file is named after its id', () => {
    const file = readKeyFile(write('ebola-drc-2026.json', JSON.stringify(key())))
    expect(file.errors).toEqual([])
    expect(file.key?.entries).toHaveLength(3)
  })

  it('reports a file that is not JSON, or not named after its id', () => {
    expect(readKeyFile(write('broken.json', '{ "schemaVersion": 1,')).errors).toEqual([expect.stringMatching(/^not valid JSON/)])
    expect(readKeyFile(write('ebola.json', JSON.stringify(key()))).errors).toEqual(['the file is named ebola.json, not after its id ebola-drc-2026'])
  })
})
