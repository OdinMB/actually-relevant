import { describe, expect, it } from 'vitest'
import type { FactCheck } from '../schemas/research.js'
import type { StandsAnswer } from '../schemas/overviews.js'
import type { ModelCall } from './overviewLink.js'
import {
  carriesDate,
  refreshStands,
  servedStands,
  standsCheckItems,
  standsCodeChecks,
  standsFacts,
  standsSignature,
  type MemberFact,
  type OfferedFact,
  type StandsDeps,
} from './overviewStands.js'
import type { PoolFact, PoolSource } from './researchPool.js'
import { boxCheckItems, type ContextFactData } from './storyContextChecks.js'

const TODAY = '2026-11-18'
const WINDOWS = { fastDays: 14, slowDays: 365 }
const OPTIONS = { maxStandsFacts: 60, minStandsFacts: 3, maxStandsSentences: 4, maxDoingSentences: 2 }

const source = (storyId: string, ref: string, over: Partial<PoolSource> = {}): PoolSource => ({
  id: `src-${storyId}-${ref}`,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url: `https://${storyId}.example/${ref}`,
  outlet: `Outlet ${storyId}`,
  title: `Page ${storyId} ${ref}`,
  date: '2026-11-10',
  kind: 'news-report',
  country: 'DR Congo',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'pass-1',
  ...over,
})

type Structured = NonNullable<PoolFact['structured']>

const fact = (id: string, statement: string, structured: Partial<Structured> = {}, over: Partial<PoolFact> = {}): PoolFact => ({
  id,
  ref: 'S1F1',
  sourceRef: 'S1',
  reusedFromId: null,
  supportingSentence: `${statement} (as reported)`,
  passage: null,
  supportFound: true,
  statement,
  measures: '',
  slot: null,
  structured: {
    value: null,
    valueHigh: null,
    unit: '',
    approx: 'exact',
    provisional: false,
    counted: '',
    place: '',
    asOf: '2026-11-10',
    credited: '',
    creditedKind: null,
    validity: 'fast',
    by: { model: 'm', promptVersion: 'v' },
    ...structured,
  },
  extractedBy: { model: 'm', promptVersion: 'v' },
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: { model: 'm', promptVersion: 'v', passId: 'pass-1' },
  status: 'unreviewed',
  firstPassId: 'pass-1',
  drop: null,
  ...over,
})

const member = (storyId: string, f: PoolFact, over: { published?: boolean; source?: Partial<PoolSource> } = {}): MemberFact => ({
  storyId,
  published: over.published ?? true,
  fact: f,
  source: source(storyId, f.sourceRef, over.source),
})

const call = <T>(parsed: T | null, costUsd = 0.01): ModelCall<T> => ({ parsed, costUsd, model: 'writer' })

const allSupported = (n: number): FactCheck => ({
  items: Array.from({ length: n }, (_, i) => ({ number: i + 1, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })),
})

/** Three current facts from two members, as most refreshes see them. */
function offer(): OfferedFact[] {
  return standsFacts(
    [
      member('a', fact('fa1', 'Cases rose to 120.')),
      member('a', fact('fa2', 'Vaccination began in Bunia.', { validity: 'fixed', asOf: '2026-11-01' }, { ref: 'S1F2' })),
      member('b', fact('fb1', 'The WHO sent 40 staff.', { asOf: '2026-11-05' })),
    ],
    TODAY,
    OPTIONS,
    WINDOWS,
  )
}

describe('the facts offered', () => {
  it("take only published members' usable, structured page facts, never an earlier story's, once each", () => {
    const shared = fact('fa1', 'Cases rose to 120.')
    const offered = standsFacts(
      [
        member('a', shared),
        member('b', { ...shared, id: 'fb-dup' }, { source: { url: 'https://a.example/S1' } }),
        member('a', fact('fa2', 'A demoted fact.', {}, { ref: 'S1F2', status: 'demoted' })),
        member('a', fact('fa3', 'An unsupported fact.', {}, { ref: 'S1F3', verdict: 'unsupported' })),
        member('a', fact('fa4', 'An unstructured fact.', {}, { ref: 'S1F4', structured: null })),
        member('a', fact('fa5', 'An earlier story.', {}, { ref: 'E1F1', sourceRef: 'E1' }), { source: { origin: 'earlier', earlierStoryId: 'old' } }),
        member('c', fact('fc1', 'An unpublished member.'), { published: false }),
      ],
      TODAY,
      OPTIONS,
      WINDOWS,
    )
    expect(offered.map(o => o.id)).toEqual(['fa1'])
  })

  it('put current facts first, then the newest, number each source in turn, and keep every response fact past the cap', () => {
    const offered = standsFacts(
      [
        member('a', fact('old', 'Cases were 10 in May.', { asOf: '2026-05-12' })),
        member('a', fact('new', 'Cases rose to 120.', { asOf: '2026-11-12' }, { ref: 'S1F2' })),
        member('b', fact('mid', 'The WHO sent 40 staff.', { asOf: '2026-11-08' })),
        member('b', fact('resp', 'The ministry opened two clinics.', { asOf: '2026-04-01' }, { ref: 'S1F2', slot: 'response' })),
      ],
      TODAY,
      { ...OPTIONS, maxStandsFacts: 2 },
      WINDOWS,
    )
    expect(offered.map(o => [o.id, o.ref, o.current])).toEqual([
      ['new', 'S1F1', true],
      ['mid', 'S2F1', true],
      ['resp', 'S2F2', false],
    ])
    expect(offered[1]!.fact.source.id).toBe('S2')
    expect(offered[0]!.fact.ref).toBe('S1F1')
  })
})

describe('a sentence carrying its date', () => {
  const on = (asOf: string | null, sourceDate: string | null = null) => ({ asOf, source: { date: sourceDate } }) as Pick<ContextFactData, 'asOf' | 'source'>

  it('names the day with its month, the month, the year, or the date as written', () => {
    expect(carriesDate('Cases were 10 on May 12.', on('2026-05-12'))).toBe(true)
    expect(carriesDate('By 12 May cases were 10.', on('2026-05-12'))).toBe(true)
    expect(carriesDate('By Sept. 3 cases were 10.', on('2026-09-03'))).toBe(true)
    expect(carriesDate('In May cases were 10.', on('2026-05'))).toBe(true)
    expect(carriesDate('In 2025 cases were 10.', on('2025'))).toBe(true)
    expect(carriesDate('As of 2026-05-12, cases were 10.', on('2026-05-12'))).toBe(true)
    expect(carriesDate('Cases were 10 in May.', on(null, '2026-05-12'))).toBe(false)
    expect(carriesDate('Cases were 10 on May 12.', on(null, '2026-05-12'))).toBe(true)
  })

  it('takes no other day, month or year for it, and none for a fact with no date', () => {
    expect(carriesDate('Cases were 10 on May 1.', on('2026-05-12'))).toBe(false)
    expect(carriesDate('Cases were 10 on May 120.', on('2026-05-12'))).toBe(false)
    expect(carriesDate('In Mayotte cases were 10.', on('2026-05'))).toBe(false)
    expect(carriesDate('In 20251 cases were 10.', on('2025'))).toBe(false)
    expect(carriesDate('Cases were 10.', on(null, null))).toBe(false)
  })
})

describe('the code checks', () => {
  const expired = (): Map<string, OfferedFact> => {
    const offered = standsFacts(
      [member('a', fact('now', 'Cases rose to 120.')), member('a', fact('then', 'Cases were 10.', { asOf: '2026-05-12' }, { ref: 'S1F2' }))],
      TODAY,
      OPTIONS,
      WINDOWS,
    )
    return new Map(offered.map(o => [o.ref, o]))
  }

  it('drop a line over the caps, with no text, or citing nothing or an unknown fact', () => {
    const line = (text: string, factIds: string[]) => ({ text, factIds })
    const answer: StandsAnswer = {
      sentences: [line('Cases rose to 120.', ['S1F1']), line('  ', ['S1F1']), line('Something.', []), line('Unknown.', ['S9F9']), line('Fifth.', ['S1F1'])],
      doing: [line('Doing.', ['S1F1']), line('Doing more.', ['S1F1']), line('A third.', ['S1F1'])],
    }
    const { lines, drops } = standsCodeChecks(answer, expired(), OPTIONS)
    expect(lines.map(l => l.label)).toEqual(['Sentence 1', 'Doing 1', 'Doing 2'])
    expect(drops.map(d => [d.label, d.cause])).toEqual([
      ['Sentence 2', 'structure'],
      ['Sentence 3', 'structure'],
      ['Sentence 4', 'structure'],
      ['Sentence 5', 'structure'],
      ['Doing 3', 'structure'],
    ])
  })

  it('keep a sentence stating an expired fact only with its date, and what is being done only from current facts', () => {
    const answer: StandsAnswer = {
      sentences: [
        { text: 'Cases were 10 in mid-year and rose to 120.', factIds: ['S1F1', 'S1F2'] },
        { text: 'Cases were 10 on May 12 and have since risen to 120.', factIds: ['S1F1', 'S1F2'] },
      ],
      doing: [{ text: 'Teams track cases.', factIds: ['S1F2'] }],
    }
    const { lines, drops } = standsCodeChecks(answer, expired(), OPTIONS)
    expect(lines.map(l => l.label)).toEqual(['Sentence 2'])
    expect(drops.map(d => [d.label, d.cause])).toEqual([
      ['Sentence 1', 'expired'],
      ['Doing 1', 'expired'],
    ])
  })
})

describe('the check items', () => {
  it("are the cards' sentence items for the same facts", () => {
    const offered = offer()
    const facts = new Map(offered.map(o => [o.ref, o.fact]))
    const lines = [{ part: 'sentence' as const, label: 'Box 1 sentence 1', text: 'Cases rose to 120 and the WHO sent 40 staff.', refs: ['S1F1', 'S2F1'] }]
    const box = boxCheckItems(
      [{ type: 'compared', heading: 'H', teaser: 'T', place: null, sentences: [{ text: lines[0]!.text, factIds: lines[0]!.refs }], visual: null }],
      facts,
      TODAY,
      WINDOWS,
    )
    expect(standsCheckItems(lines, facts)).toEqual([box[0]!.checked])
    expect(box[0]!.checked.evidence.length).toBeGreaterThan(0)
  })
})

describe('a refresh', () => {
  const answer: StandsAnswer = {
    sentences: [
      { text: 'Cases rose to 120.', factIds: ['S1F1'] },
      { text: 'Vaccination began in Bunia.', factIds: ['S1F2'] },
    ],
    doing: [{ text: 'The WHO sent 40 staff.', factIds: ['S2F1'] }],
  }

  const deps = (write: StandsAnswer | null, check: (n: number) => FactCheck | null = allSupported): StandsDeps & { checks: number[] } => {
    const checks: number[] = []
    return {
      checks,
      write: async () => call(write),
      check: async items => {
        checks.push(items.length)
        return call(check(items.length), 0.002)
      },
    }
  }

  it('writes nothing, and calls nothing, from fewer than the least facts', async () => {
    const d = deps(answer)
    const result = await refreshStands({ title: 'Ebola', entries: [] }, offer().slice(0, 2), TODAY, d, OPTIONS)
    expect(result.outcome).toBe('too_few_facts')
    expect(d.checks).toEqual([])
  })

  it('keeps every checked line, citing pool facts by row id, and counts the cost', async () => {
    const d = deps(answer)
    const result = await refreshStands({ title: 'Ebola', entries: [] }, offer(), TODAY, d, OPTIONS)
    expect(result.outcome).toBe('written')
    expect(result.sentences).toEqual([
      { text: 'Cases rose to 120.', facts: ['fa1'] },
      { text: 'Vaccination began in Bunia.', facts: ['fa2'] },
    ])
    expect(result.doing).toEqual([{ text: 'The WHO sent 40 staff.', facts: ['fb1'] }])
    expect(d.checks).toEqual([3])
    expect(result.costUsd).toBeCloseTo(0.012)
    expect(result.checked).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.model).toBe('writer')
  })

  it('drops a line the check fails, one it leaves out, and one copying its source, with no repair', async () => {
    const words = 'Health officials said that the WHO sent 40 staff to the region quickly this week.'
    const copying: StandsAnswer = { ...answer, doing: [{ text: words, factIds: ['S2F1'] }] }
    const offered = offer().map(o => (o.ref === 'S2F1' ? { ...o, fact: { ...o.fact, supportingSentence: words } } : o))
    const check = (): FactCheck => ({ items: [{ number: 1, supported: false, problem: 'Not 120.', key: false, copiedSentence: '', followsSource: '' }] })
    const d = deps(copying, check)
    const result = await refreshStands({ title: 'Ebola', entries: [] }, offered, TODAY, d, OPTIONS)
    expect(result.outcome).toBe('none_kept')
    expect(result.drops.map(x => [x.label, x.cause])).toEqual([
      ['Doing 1', 'copying'],
      ['Sentence 1', 'check'],
      ['Sentence 2', 'unjudged'],
    ])
    expect(d.checks).toEqual([2])
    expect(result.failed).toBe(3)
  })

  it('fails when a call gives nothing', async () => {
    expect((await refreshStands({ title: 'Ebola', entries: [] }, offer(), TODAY, deps(null), OPTIONS)).outcome).toBe('failed')
    expect(
      (
        await refreshStands(
          { title: 'Ebola', entries: [] },
          offer(),
          TODAY,
          deps(answer, () => null),
          OPTIONS,
        )
      ).outcome,
    ).toBe('failed')
  })

  it('shows the write each fact as rendered, under its offer ref, current or not, and the limits', async () => {
    let seen: Parameters<StandsDeps['write']>[0] | null = null
    await refreshStands(
      { title: 'Ebola', entries: [{ title: 'First', date: '2026-11-01', role: { role: 'routine', roleKind: null } }] },
      offer(),
      TODAY,
      {
        write: async input => {
          seen = input
          return call(null)
        },
        check: async () => call(null),
      },
      OPTIONS,
    )
    expect(seen!.facts.map(f => [f.id, f.current, f.outlet])).toEqual([
      ['S1F1', true, 'Outlet a'],
      ['S2F1', true, 'Outlet b'],
      ['S1F2', true, 'Outlet a'],
    ])
    expect(seen!.maxSentences).toBe(4)
    expect(seen!.today).toBe(TODAY)
  })
})

describe('the signature', () => {
  const entries = [{ storyId: 'a', role: { role: 'routine' as const, roleKind: null } }]

  it('changes when a fact is gained, lost or expires, or a role changes, and not with order', () => {
    const offered = offer()
    const base = standsSignature(offered, entries)
    expect(standsSignature([...offered].reverse(), entries)).toBe(base)
    expect(standsSignature(offered.slice(1), entries)).not.toBe(base)
    expect(standsSignature([{ ...offered[0]!, current: false }, ...offered.slice(1)], entries)).not.toBe(base)
    expect(standsSignature(offered, [{ storyId: 'a', role: { role: 'turning', roleKind: 'response' } }])).not.toBe(base)
  })
})

describe('the stands as served', () => {
  const facts = (): Map<string, { usable: boolean; published: boolean; fact: ContextFactData }> =>
    new Map(offer().map(o => [o.id, { usable: true, published: true, fact: o.fact }]))

  it('drop a line citing a fact demoted or gone, or only unpublished members, and cite only published ones', () => {
    const served = facts()
    served.set('fa2', { ...served.get('fa2')!, usable: false })
    served.set('fb1', { ...served.get('fb1')!, published: false })
    const result = servedStands(
      {
        sentences: [
          { text: 'Cases rose to 120 as the WHO sent 40 staff.', facts: ['fa1', 'fb1'] },
          { text: 'Vaccination began.', facts: ['fa2'] },
          { text: 'Gone.', facts: ['missing'] },
        ],
        doing: [{ text: 'The WHO sent 40 staff.', facts: ['fb1'] }],
      },
      served,
      TODAY,
      WINDOWS,
    )
    expect(result).toEqual({ sentences: [{ text: 'Cases rose to 120 as the WHO sent 40 staff.', facts: ['fa1'] }], doing: [] })
  })

  it('drop a sentence whose fact expired since without its date, and what is being done once a fact expires', () => {
    const later = '2026-12-20'
    const result = servedStands(
      {
        sentences: [
          { text: 'Cases rose to 120.', facts: ['fa1'] },
          { text: 'Cases rose to 120 by November 10.', facts: ['fa1'] },
          { text: 'Vaccination began in Bunia.', facts: ['fa2'] },
        ],
        doing: [{ text: 'The WHO sent 40 staff.', facts: ['fb1'] }],
      },
      facts(),
      later,
      WINDOWS,
    )
    expect(result.sentences.map(s => s.text)).toEqual(['Cases rose to 120 by November 10.', 'Vaccination began in Bunia.'])
    expect(result.doing).toEqual([])
  })
})
