import { describe, expect, it } from 'vitest'
import type { ReviewAnswer, StandsAnswer } from '../schemas/overviews.js'
import type { FactCheck } from '../schemas/research.js'
import type { CloseCase } from './overviewClose.js'
import type { ModelCall } from './overviewLink.js'
import type { ReviewCase } from './overviewReview.js'
import type { MemberFact } from './overviewStands.js'
import type { OverviewState } from './overviewTypes.js'
import { runUpkeep, type StandsCase, type UpkeepDeps } from './overviewUpkeep.js'
import type { PoolFact, PoolSource } from './researchPool.js'

const NOW = new Date('2026-11-18T03:00:00Z')
const AT = { clock: NOW, now: NOW, today: '2026-11-18' }
const routine = { role: 'routine' as const, roleKind: null }
const call = <T>(parsed: T | null, costUsd = 0.01): ModelCall<T> => ({ parsed, costUsd, model: 'm' })

const state = (id: string, over: Partial<OverviewState> = {}): OverviewState => ({
  id,
  scope: 'ongoing',
  status: 'open',
  closedReason: null,
  frozen: false,
  hidden: false,
  lastEntryAt: new Date('2026-11-17T12:00:00Z'),
  closingSince: null,
  activeEntries: 4,
  unpublished: [],
  entriesAtLastReview: 3,
  reviewedAt: new Date('2026-11-10T00:00:00Z'),
  burstJoins: 0,
  burstAt: null,
  closureReviewed: false,
  ...over,
})

const reviewCase = (id: string): ReviewCase => ({
  overviewId: id,
  title: 'Ebola',
  charter: { in: 'In.', out: [], endEvent: 'End.' },
  scope: 'ongoing',
  frozen: false,
  entries: [1, 2, 3].map(n => ({
    entryId: `e${n}`,
    storyId: `s${n}`,
    title: `T${n}`,
    label: 'L',
    summary: 'S.',
    date: `2026-11-0${n}`,
    role: routine,
    locked: false,
  })),
  closingStoryId: null,
})

const source = (storyId: string): PoolSource => ({
  id: `src-${storyId}`,
  ref: 'S1',
  origin: 'search',
  earlierStoryId: null,
  url: `https://${storyId}.example/1`,
  outlet: 'Outlet',
  title: 'Page',
  date: '2026-11-10',
  kind: 'news-report',
  country: '',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: 'p',
})

const member = (storyId: string, id: string, statement: string, ref = 'S1F1'): MemberFact => {
  const fact: PoolFact = {
    id,
    ref,
    sourceRef: 'S1',
    reusedFromId: null,
    supportingSentence: `${statement} (reported)`,
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
      asOf: '2026-11-12',
      credited: '',
      creditedKind: null,
      validity: 'fast',
      by: { model: 'm', promptVersion: 'v' },
    },
    extractedBy: { model: 'm', promptVersion: 'v' },
    verdict: 'supported',
    verdictProblem: null,
    checkedBy: null,
    status: 'unreviewed',
    firstPassId: 'p',
    drop: null,
  }
  return { storyId, published: true, fact, source: source(storyId) }
}

const standsCase = (lastSignature: string | null = null): StandsCase => ({
  overviewId: 'o1',
  title: 'Ebola',
  entries: [
    { storyId: 'a', title: 'A', date: '2026-11-10', role: routine },
    { storyId: 'b', title: 'B', date: '2026-11-11', role: routine },
  ],
  members: [member('a', 'f1', 'Cases rose to 120.'), member('a', 'f2', 'Vaccination began.', 'S1F2'), member('b', 'f3', 'The WHO sent 40 staff.')],
  lastSignature,
})

const keepAll: ReviewAnswer = {
  entries: ['E1', 'E2', 'E3'].map(id => ({ id, belongs: 'yes' as const, reason: 'Same.', role: 'routine' as const, roleKind: null })),
  charter: { in: 'In.', out: [], endEvent: 'End.' },
  title: '',
  clearFreeze: false,
}

const supported = (n: number): FactCheck => ({
  items: Array.from({ length: n }, (_, i) => ({ number: i + 1, supported: true, problem: '', key: false, copiedSentence: '', followsSource: '' })),
})

/** Fake deps recording every write, in order. */
function fakes(over: Partial<UpkeepDeps> = {}): UpkeepDeps & { writes: string[] } {
  const writes: string[] = []
  const stands: StandsAnswer = { sentences: [{ text: 'Cases rose to 120.', factIds: ['S1F1'] }], doing: [] }
  return {
    writes,
    closings: async () => [],
    states: async () => [],
    reviewCase: async id => reviewCase(id),
    auditPicks: async () => [],
    standsCases: async () => [],
    close: { close: async () => call(null), closeCheck: async () => call(null) },
    review: { review: async () => call(keepAll, 0.1) },
    stands: { write: async () => call(stands), check: async items => call(supported(items.length)) },
    applyClosing: async (c, r) => void writes.push(`closing:${c.overviewId}:${r.outcome}`),
    applyStatus: async (s, moves) => void writes.push(`status:${s.id}:${moves.map(m => (m.kind === 'status' ? m.to : m.kind)).join(',')}`),
    applyBurst: async s => void writes.push(`burst:${s.id}`),
    applyReview: async (c, r) => void writes.push(`review:${c.overviewId}:${r.trigger}:${r.outcome}`),
    applyAudit: async (c, r) => void writes.push(`audit:${c.overviewId}:${r.outcome}`),
    applyStands: async (c, r, signature) => void writes.push(`stands:${c.overviewId}:${r.outcome}:${signature === null ? 'none' : 'signed'}`),
    ...over,
  }
}

describe('the upkeep after linking', () => {
  it('runs the closing checks, the status machine, the reviews, the audit and the stands, in that order', async () => {
    const closing: CloseCase = {
      overviewId: 'o1',
      charter: { in: 'In.', out: [], endEvent: 'End.' },
      story: { id: 's', title: 'T', label: 'L', summary: 'S.', datePublished: NOW, date: '2026-11-18', issueId: null, facts: [] },
      entries: [],
    }
    const quiet = state('o2', { lastEntryAt: new Date('2026-10-01T00:00:00Z') })
    const due = state('o3', { activeEntries: 6 })
    const deps = fakes({
      closings: async () => [closing],
      states: async () => [quiet, due],
      auditPicks: async () => ['o4'],
      standsCases: async () => [standsCase()],
    })
    const tally = await runUpkeep(deps, AT)
    expect(deps.writes).toEqual(['closing:o1:failed', 'status:o2:quiet', 'review:o3:entries:reviewed', 'audit:o4:reviewed', 'stands:o1:written:signed'])
    expect(tally).toMatchObject({ closingsChecked: 1, moves: 1, reviews: 1, audits: 1, standsRefreshes: 1, standsWritten: 1, standsChecked: 1, failed: 1 })
  })

  it('freezes on a burst and reviews it in the same run, from the states read again', async () => {
    let reads = 0
    const deps = fakes({
      states: async () => (reads++ === 0 ? [state('o1', { burstJoins: 6 })] : [state('o1', { frozen: true, burstAt: NOW })]),
    })
    const tally = await runUpkeep(deps, AT)
    expect(deps.writes).toEqual(['burst:o1', 'review:o1:burst:reviewed'])
    expect(tally.bursts).toBe(1)
  })

  it('refreshes no stands whose signature has not changed, and signs no failed refresh', async () => {
    const first = fakes({ standsCases: async () => [standsCase()] })
    await runUpkeep(first, AT)
    let signature: string | null = null
    const capture = fakes({
      standsCases: async () => [standsCase()],
      applyStands: async (_c, _r, s) => {
        signature = s
      },
    })
    await runUpkeep(capture, AT)
    const again = fakes({ standsCases: async () => [standsCase(signature)] })
    expect((await runUpkeep(again, AT)).standsRefreshes).toBe(0)
    const failing = fakes({ standsCases: async () => [standsCase()], stands: { write: async () => call(null), check: async () => call(null) } })
    await runUpkeep(failing, AT)
    expect(failing.writes).toEqual(['stands:o1:failed:none'])
  })

  it('goes on past an overview that throws, and starts nothing once switched off', async () => {
    const deps = fakes({
      states: async () => [state('o1', { lastEntryAt: new Date('2026-10-01T00:00:00Z') }), state('o2', { lastEntryAt: new Date('2026-10-01T00:00:00Z') })],
      applyStatus: async s => {
        if (s.id === 'o1') throw new Error('boom')
        deps.writes.push(`status:${s.id}`)
      },
    })
    const tally = await runUpkeep(deps, AT)
    expect(deps.writes).toEqual(['status:o2'])
    expect(tally.errors.map(e => [e.part, e.id])).toEqual([['status', 'o1']])

    let asked = 0
    const off = fakes({ states: async () => [state('o1', { lastEntryAt: new Date('2026-10-01T00:00:00Z') })], standsCases: async () => [standsCase()] })
    const stopped = await runUpkeep(off, AT, () => asked++ < 1)
    expect(off.writes).toEqual(['status:o1:quiet'])
    expect(stopped.stopped).toBe(true)
  })
})
