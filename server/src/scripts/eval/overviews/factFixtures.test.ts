import { describe, it, expect } from 'vitest'
import type { SelectDb } from '../readOnlyDb.js'
import { FACT_FIXTURES_VERSION, factsOfRun, pickFacts, reusableFixtures, sampleFacts, statesNumber, type FactFixtures, type RunRow } from './factFixtures.js'

const fact = (id: string, statement: string, found = true) => ({ id, statement, supportingSentence: `Sentence of ${id}.`, measures: '', found })

const source = (id: string, facts: ReturnType<typeof fact>[]) => ({
  id,
  outlet: `Outlet ${id}`,
  url: `https://example.org/${id}`,
  date: '2026-11-12T08:00:00Z',
  facts,
})

/** `n` facts of source `id` that each state a number. */
const numbered = (id: string, n: number) => Array.from({ length: n }, (_, i) => fact(`${id}F${i + 1}`, `Cases rose to ${(i + 1) * 100}.`))

const run = (id: string, storyId: string | null, sources: unknown): RunRow => ({ id, story_id: storyId, started_at: new Date('2026-11-14T02:20:00Z'), sources })

describe('statesNumber', () => {
  it('counts a significant number, as the fact check hints do', () => {
    expect(statesNumber('Cases rose to 4,887.')).toBe(true)
    expect(statesNumber('Prices rose 3%.')).toBe(true)
    expect(statesNumber('Three people died on day 2.')).toBe(false)
    expect(statesNumber('The H5N1 strain spread.')).toBe(false)
  })
})

describe('factsOfRun', () => {
  it('takes found facts that state a number, at most 3 a source and 10 a run, round robin over the sources', () => {
    const facts = factsOfRun(
      run('r1', 's1', [source('S0', numbered('S0', 5)), source('S1', numbered('S1', 2)), source('S2', numbered('S2', 4)), source('S3', numbered('S3', 4))]),
    )
    expect(facts?.map(f => f.sourceId + ':' + f.statement.replace('Cases rose to ', ''))).toEqual([
      'S0:100.',
      'S1:100.',
      'S2:100.',
      'S3:100.',
      'S0:200.',
      'S1:200.',
      'S2:200.',
      'S3:200.',
      'S0:300.',
      'S2:300.',
    ])
    expect(facts?.[0]).toEqual({
      key: 'r1:S0F1',
      runId: 'r1',
      storyId: 's1',
      sourceId: 'S0',
      outlet: 'Outlet S0',
      url: 'https://example.org/S0',
      language: null,
      date: '2026-11-12T08:00:00Z',
      statement: 'Cases rose to 100.',
      measures: '',
      sentence: 'Sentence of S0F1.',
    })
  })

  it("keeps a source's date when it has one, and reads a source stored without one as undated", () => {
    const facts = factsOfRun(
      run('r1', 's1', [
        { ...source('S0', numbered('S0', 1)), date: null },
        { id: 'S1', outlet: 'Outlet S1', url: 'https://example.org/S1', facts: numbered('S1', 1) },
      ]),
    )
    expect(facts?.map(f => f.date)).toEqual([null, null])
  })

  it('skips a fact whose sentence was not found in its source, or that states no number', () => {
    const facts = factsOfRun(
      run('r1', 's1', [source('S0', [fact('S0F1', 'Cases rose to 100.', false), fact('S0F2', 'Two people died.'), fact('S0F3', 'Cases rose to 300.')])]),
    )
    expect(facts?.map(f => f.key)).toEqual(['r1:S0F3'])
  })

  it('returns null for a run stored in an older shape', () => {
    expect(factsOfRun(run('r1', 's1', [{ id: 'S0', outlet: 'X', url: 'u', facts: [{ id: 'S0F1', statement: 'x', supportingSentence: 'y' }] }]))).toBeNull()
    expect(factsOfRun(run('r1', 's1', null))).toBeNull()
  })
})

describe('pickFacts', () => {
  it('fills the sample from the newest runs, one run per story, and counts the runs in an older shape', () => {
    const rows = [
      run('r1', 's1', [source('S0', numbered('S0', 2))]),
      run('r2', 's1', [source('S0', numbered('S0', 2))]),
      run('r3', 's2', 'old'),
      run('r4', 's3', [source('S0', numbered('S0', 3))]),
      run('r5', 's4', [source('S0', numbered('S0', 3))]),
    ]
    const picked = pickFacts(rows, 4, new Set())
    expect(picked.facts.map(f => f.key)).toEqual(['r1:S0F1', 'r1:S0F2', 'r4:S0F1', 'r4:S0F2'])
    expect(picked).toMatchObject({ runsRead: 4, olderShape: 1 })
    expect([...picked.stories]).toEqual(['s1', 's3'])
  })

  it('leaves out stories an earlier page already gave facts', () => {
    expect(pickFacts([run('r9', 's1', [source('S0', numbered('S0', 1))])], 5, new Set(['s1'])).facts).toEqual([])
  })
})

describe('reusableFixtures', () => {
  const cached = (extra: Partial<FactFixtures> | Record<string, unknown>) => ({
    version: FACT_FIXTURES_VERSION,
    createdAt: '',
    anchor: null,
    size: 300,
    dbClass: 'local',
    readOnlyMode: 'session',
    facts: [],
    runsRead: 0,
    olderShape: 0,
    shortfalls: [],
    ...extra,
  })

  it('reuses a cached sample of the size asked for, and resamples one of another size or an older version', () => {
    expect(reusableFixtures(cached({}), 300)?.size).toBe(300)
    expect(reusableFixtures(cached({}), 100)).toBeNull()
    expect(reusableFixtures(cached({ version: 1 }), 300)).toBeNull()
  })
})

/** A session whose run query pages through `runs`, and whose language query knows `languages` by URL. */
function stubDb(runs: RunRow[], languages: Record<string, string>) {
  const offsets: unknown[] = []
  const db: SelectDb = {
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      if (query.join('?').includes('story_research_runs')) {
        const [limit, offset] = values as [number, number]
        offsets.push(offset)
        return runs.slice(offset, offset + limit) as T
      }
      const urls = values[0] as string[]
      return urls.filter(u => u in languages).map(url => ({ url, language: languages[url] })) as T
    },
  }
  return { db, offsets }
}

describe('sampleFacts', () => {
  const page1 = [
    { ...run('r1', 's1', [source('S0', numbered('S0', 1))]), started_at: new Date('2026-11-15T10:00:00Z') },
    run('r2', 's1', [source('S0', numbered('S0', 1))]),
  ]
  const page2 = [run('r3', 's2', [source('S1', numbered('S1', 3))]), run('r4', 's3', [source('S0', numbered('S0', 3))])]

  it('reads page after page until the sample is full, the anchor the newest run', async () => {
    const { db, offsets } = stubDb([...page1, ...page2], { 'https://example.org/S0': 'fr' })
    const sample = await sampleFacts(db, 3, 2)
    expect(offsets).toEqual([0, 2])
    expect(sample.facts.map(f => [f.key, f.language])).toEqual([
      ['r1:S0F1', 'fr'],
      ['r3:S1F1', null],
      ['r3:S1F2', null],
    ])
    expect(sample).toMatchObject({ anchor: '2026-11-15T10:00:00.000Z', runsRead: 3, olderShape: 0, shortfalls: [] })
  })

  it('stops at the last page and says how short the sample fell', async () => {
    const { db, offsets } = stubDb([...page1, ...page2], {})
    const sample = await sampleFacts(db, 50, 3)
    expect(offsets).toEqual([0, 3])
    expect(sample.facts).toHaveLength(7)
    expect(sample.shortfalls).toEqual(['7 of 50 facts: the database holds no more qualifying facts'])
  })
})
