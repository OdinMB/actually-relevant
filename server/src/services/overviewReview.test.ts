import { describe, expect, it } from 'vitest'
import type { ReviewAnswer } from '../schemas/overviews.js'
import type { ModelCall } from './overviewLink.js'
import { allowedActions, auditOverview, reviewOverview, type ReviewCase, type ReviewDeps, type ReviewEntry } from './overviewReview.js'

const routine = { role: 'routine' as const, roleKind: null }

const entry = (n: number, over: Partial<ReviewEntry> = {}): ReviewEntry => ({
  entryId: `e${n}`,
  storyId: `s${n}`,
  title: `Story ${n}`,
  label: 'Label',
  summary: 'Summary.',
  date: `2026-10-0${n}`,
  role: routine,
  locked: false,
  ...over,
})

const base = (over: Partial<ReviewCase> = {}): ReviewCase => ({
  overviewId: 'o',
  title: 'Ebola in Ituri',
  charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' },
  scope: 'forming',
  frozen: false,
  entries: [entry(1), entry(2), entry(3)],
  closingStoryId: null,
  lockedOut: [],
  ...over,
})

const judged = (id: string, belongs: 'yes' | 'no' = 'yes', role: Pick<ReviewAnswer['entries'][number], 'role' | 'roleKind'> = routine) => ({
  id,
  belongs,
  reason: belongs === 'yes' ? 'Same outbreak.' : 'Cholera, not Ebola.',
  ...role,
})

const answer = (over: Partial<ReviewAnswer> = {}): ReviewAnswer => ({
  entries: [judged('E1'), judged('E2'), judged('E3')],
  charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' },
  title: '',
  clearFreeze: false,
  ...over,
})

const deps = (parsed: ReviewAnswer | null): ReviewDeps & { audits: boolean[] } => {
  const audits: boolean[] = []
  return {
    audits,
    review: async (_input, options): Promise<ModelCall<ReviewAnswer>> => {
      audits.push(options.audit)
      return { parsed, costUsd: 0.08, model: 'large' }
    },
  }
}

describe('what a review may do', () => {
  it('detaches, relabels, narrows and retitles', () => {
    const { actions, refusals, kept } = allowedActions(
      base(),
      answer({
        entries: [judged('E1'), judged('E2', 'no'), judged('E3', 'yes', { role: 'turning_point', roleKind: 'response' })],
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'cholera in DR Congo'], endEvent: 'The ministry declares it over' },
        title: 'Ebola in Ituri and North Kivu',
      }),
    )
    expect(refusals).toEqual([])
    expect(kept).toBe(2)
    expect(actions).toEqual([
      { kind: 'detach', entryId: 'e2', storyId: 's2', reason: 'Cholera, not Ebola.' },
      { kind: 'relabel', entryId: 'e3', storyId: 's3', from: routine, to: { role: 'turning_point', roleKind: 'response' } },
      {
        kind: 'narrow',
        added: ['cholera in DR Congo'],
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'cholera in DR Congo'], endEvent: 'The ministry declares it over' },
      },
      { kind: 'retitle', from: 'Ebola in Ituri', to: 'Ebola in Ituri and North Kivu' },
    ])
  })

  it('refuses adding or restoring an entry, widening the charter, and touching an editor-attached entry', () => {
    const { actions, refusals, kept } = allowedActions(
      base({ entries: [entry(1), entry(2, { locked: true }), entry(3)] }),
      answer({
        entries: [judged('E1'), judged('E2', 'no'), judged('E3'), judged('E4'), judged('E1', 'no')],
        charter: { in: 'Ebola anywhere in DR Congo.', out: [], endEvent: 'The WHO declares it over' },
      }),
    )
    expect(actions).toEqual([])
    expect(kept).toBe(3)
    expect(refusals.map(r => r.what)).toEqual(['E2', 'E4', 'E1', 'charter', 'charter', 'charter'])
  })

  it('never adds again an OUT entry an editor’s undo took out, and keeps the others it adds', () => {
    const { actions, refusals } = allowedActions(
      base({ lockedOut: ['Cholera in DR Congo'] }),
      answer({
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'cholera in  DR Congo', 'Measles'], endEvent: 'The ministry declares it over' },
      }),
    )
    expect(actions).toEqual([
      {
        kind: 'narrow',
        added: ['Measles'],
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'Measles'], endEvent: 'The ministry declares it over' },
      },
    ])
    expect(refusals).toEqual([{ what: 'charter', reason: 'adds an OUT entry an editor took out: cholera in  DR Congo' }])
  })

  it('applies the OUT entries a widening answer adds, onto the current charter', () => {
    const { actions } = allowedActions(base(), answer({ charter: { in: 'Ebola anywhere.', out: ['Measles'], endEvent: 'Never' } }))
    expect(actions).toEqual([
      {
        kind: 'narrow',
        added: ['Measles'],
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda', 'Measles'], endEvent: 'The ministry declares it over' },
      },
    ])
  })

  it('keeps an unjudged entry, and takes the same title or charter in other spacing or case as no change', () => {
    const { actions, kept } = allowedActions(
      base(),
      answer({
        entries: [judged('E1')],
        title: 'ebola in  Ituri',
        charter: { in: 'The Ebola outbreak in Ituri.', out: ['ebola in uganda'], endEvent: 'The ministry declares it over' },
      }),
    )
    expect(actions).toEqual([])
    expect(kept).toBe(3)
  })

  it('clears a freeze only on a frozen overview whose entries all belong', () => {
    expect(allowedActions(base({ frozen: true }), answer({ clearFreeze: true })).actions).toEqual([{ kind: 'unfreeze' }])
    expect(allowedActions(base(), answer({ clearFreeze: true })).actions).toEqual([])
    const wrong = allowedActions(base({ frozen: true }), answer({ clearFreeze: true, entries: [judged('E1'), judged('E2', 'no'), judged('E3')] }))
    expect(wrong.actions.map(a => a.kind)).toEqual(['detach'])
    expect(wrong.refusals).toEqual([{ what: 'freeze', reason: 'not every entry was judged to belong' }])
  })

  it('keeps the freeze while an entry is left unjudged, or judged only by an id that names no entry', () => {
    const unjudged = allowedActions(base({ frozen: true }), answer({ clearFreeze: true, entries: [judged('E1'), judged('E3')] }))
    expect(unjudged.actions).toEqual([])
    expect(unjudged.refusals).toEqual([{ what: 'freeze', reason: 'not every entry was judged to belong' }])
    const stray = allowedActions(base({ frozen: true }), answer({ clearFreeze: true, entries: [judged('E1'), judged('E3'), judged('E9')] }))
    expect(stray.actions).toEqual([])
    // Judged yes, then no under the same id: the first judgment stands, the second is refused
    const twice = allowedActions(base({ frozen: true }), answer({ clearFreeze: true, entries: [judged('E1'), judged('E2'), judged('E3'), judged('E2', 'no')] }))
    expect(twice.actions).toEqual([{ kind: 'unfreeze' }])
  })
})

describe('a review', () => {
  it('makes a forming overview public only when it keeps 3, and single when it keeps 1', async () => {
    expect((await reviewOverview(base(), 'entries', deps(answer()))).scope).toBe('ongoing')
    const cut = await reviewOverview(base(), 'entries', deps(answer({ entries: [judged('E1'), judged('E2', 'no'), judged('E3')] })))
    expect([cut.scope, cut.kept]).toEqual(['forming', 2])
    const one = await reviewOverview(base(), 'entries', deps(answer({ entries: [judged('E1'), judged('E2', 'no'), judged('E3', 'no')] })))
    expect(one.scope).toBe('single')
  })

  it('never raises the scope of an overview it leaves frozen, and lowers it', async () => {
    const frozen = await reviewOverview(base({ frozen: true }), 'burst', deps(answer()))
    expect(frozen.scope).toBe('forming')
    const cleared = await reviewOverview(base({ frozen: true }), 'burst', deps(answer({ clearFreeze: true })))
    expect(cleared.scope).toBe('ongoing')
    const lowered = await reviewOverview(
      base({ frozen: true, scope: 'ongoing' }),
      'burst',
      deps(answer({ entries: [judged('E1'), judged('E2', 'no'), judged('E3')] })),
    )
    expect(lowered.scope).toBe('forming')
  })

  it('cancels a closing when it detaches the story that began it', async () => {
    const wrong = answer({ entries: [judged('E1'), judged('E2'), judged('E3', 'no')] })
    expect((await reviewOverview(base({ closingStoryId: 's3' }), 'closure', deps(wrong))).cancelsClosing).toBe(true)
    expect((await reviewOverview(base({ closingStoryId: 's1' }), 'closure', deps(wrong))).cancelsClosing).toBe(false)
  })

  it('acts on nothing when the call fails', async () => {
    const failed = await reviewOverview(base({ scope: 'ongoing' }), 'periodic', deps(null))
    expect([failed.outcome, failed.actions, failed.scope, failed.kept]).toEqual(['failed', [], 'ongoing', 3])
  })
})

describe('the audit', () => {
  it('counts what a review would change at high effort and returns it unapplied', async () => {
    const d = deps(answer({ entries: [judged('E1', 'no'), judged('E2', 'yes', { role: 'turning_point', roleKind: 'setback' }), judged('E3'), judged('E9')] }))
    const audit = await auditOverview(base({ scope: 'ongoing', frozen: true }), d)
    expect(d.audits).toEqual([true])
    expect([audit.entries, audit.wrongJoins, audit.wrongRoles]).toEqual([3, 1, 1])
    expect(audit.errorRate).toBeCloseTo(2 / 3)
    expect(audit.actions.some(a => a.kind === 'unfreeze')).toBe(false)
  })

  it('has no error rate without an answer', async () => {
    expect((await auditOverview(base(), deps(null))).errorRate).toBeNull()
  })
})
